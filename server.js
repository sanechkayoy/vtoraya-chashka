const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const root=__dirname, dataPath=path.join(root,'data','db.json');
const send=(res,code,type,body)=>{res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(body)};
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
function read(){return JSON.parse(fs.readFileSync(dataPath,'utf8'))}
function save(d){fs.writeFileSync(dataPath,JSON.stringify(d,null,2),'utf8')}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',x=>b+=x);req.on('end',()=>{try{resolve(JSON.parse(b||'{}'))}catch(e){reject(e)}})})}
const server=http.createServer(async(req,res)=>{
  const p=url.parse(req.url).pathname;
  if(p==='/api/data') return send(res,200,'application/json',JSON.stringify(read()));
  if(p==='/api/save' && req.method==='POST'){try{const d=await body(req);save(d);return send(res,200,'application/json','{"ok":true}')}catch(e){return send(res,400,'application/json','{"ok":false}')}}
  let file=p==='/ ' ? '/public/index.html':p;
  if(p==='/') file='/public/index.html';
  if(p==='/admin') file='/admin.html';
  const full=path.join(root,file);
  if(fs.existsSync(full)&&fs.statSync(full).isFile())return send(res,200,mime[path.extname(full)]||'text/plain',fs.readFileSync(full));
  send(res,404,'text/plain','Not found');
});
server.listen(3000,()=>console.log('Откройте http://localhost:3000 и http://localhost:3000/admin'));
