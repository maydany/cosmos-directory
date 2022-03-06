const Koa = require("koa");
const Subdomain = require('koa-subdomain');
const Router = require('koa-router');
const cors = require("@koa/cors");
const proxy = require("koa-proxies");
const _ = require("lodash");
const path = require('path')
const ChainRegistry = require('./chainRegistry')

const dir = path.join(process.cwd(), '../chain-registry')
const registry = ChainRegistry(dir)

const intervals = {}
const currentUrls = {}

function updateChains(){
  Object.keys(intervals).forEach(key => {
    clearInterval(intervals[key])
    intervals.delete(key)
  })
  return registry.refresh().then(() => {
    registry.chainNames().forEach(key => {
      updateApis(key)
      intervals[key] = setInterval(() => {
        updateApis(key)
      }, 30_000)
    })
  })
}

function updateApis(key){
  const chain = registry.getChain(key)
  chain.apis.refreshUrls()
}

function loadBalanceProxy(key, type, path, options){
  const chain = registry.getChain(key)
  const url = chain && chain.apis.bestUrl(type)
  options.res.locals = {
    chain, url
  }
  const regexp = new RegExp("\^\\/"+key, 'g');
  const response = {
    changeOrigin: true,
    rewrite: path => path.replace(regexp, ''),
    target: 'https://cosmos.directory',
    events: {
      proxyReq: (proxyReq, req, res) => {
        const chain = res.locals.chain
        const url = res.locals.url
        if(!chain){
          res.writeHead(404, {
            'Content-Type': 'text/plain'
          });
          return res.end('Not found');
        }else if(!url){
          res.writeHead(502, {
            'Content-Type': 'text/plain'
          });
          return res.end('No servers available');
        }
      },
    }
  }

  if(url){
    response.target = url
    response.logs = true
  }

  return response
}

function renderJson(ctx, object){
  if(object){
    ctx.body = object
  }else{
    ctx.status = 404
    ctx.body = 'Not found'
  }
}

updateChains()
const registryInterval = setInterval(updateChains, 60_000 * 30)

const port = process.env.PORT || 3000;
const app = new Koa();
const router = new Router();
const subdomain = new Subdomain();

app.use(cors());

subdomain.use('rest', proxy("/:chain", (path, options) => loadBalanceProxy(path.chain, 'rest', path, options)));
subdomain.use('rpc', proxy("/:chain", (path, options) => loadBalanceProxy(path.chain, 'rpc', path, options)));

router.get('/', (ctx, next) => {
  renderJson(ctx, registry.chainNames())
});

router.get('/:chain', (ctx, next) => {
  const chain = registry.getChain(ctx.params.chain)
  renderJson(ctx, chain && chain.chain)
});

router.get('/:chain/assetlist', (ctx, next) => {
  const chain = registry.getChain(ctx.params.chain)
  renderJson(ctx, chain && chain.assetlist)
});

subdomain.use('registry', router.routes());

app.use(subdomain.routes());

app.listen(port);
console.log(`listening on port ${port}`);
