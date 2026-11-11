const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const {Chess}=require('chess.js');
const path=require('path');
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(req,res)=>res.json({ok:true,name:'Webplace'}));
const rooms=new Map();
const tracks=Array.from({length:15},(_,i)=>({id:i+1,name:['Coastal Sprint','Desert Loop','Alpine Pass','Forest Run','Neon Circuit'][i%5]}));
const botNames=['Nova','Pixel','Blitz','Comet','Rook','Turbo','Echo','Viper'];
function freshRoom(id,game,config={}) {
 const aiCount=game==='chess'?1:Math.max(1,Math.min(8,Number(config.aiCount)||1));
 const difficulty=['easy','medium','hard'].includes(config.difficulty)?config.difficulty:'medium';
 const bots=Array.from({length:aiCount},(_,i)=>({id:'bot-'+i,name:botNames[i],isAI:true}));
 return {id,game,players:[],bots,difficulty,aiCount,created:Date.now(),state:game==='chess'?{fen:new Chess().fen(),turn:'w',moves:[],status:'Playing'}:game==='poker'?{pot:0,round:'Waiting',lastAction:'Your turn — make a move'}:{track:1,racers:{},started:true}};
}
function pub(r){return {id:r.id,game:r.game,difficulty:r.difficulty,aiCount:r.aiCount,players:[...r.players.map(p=>({id:p.id,name:p.name,isAI:false})),...r.bots],state:r.state,tracks:r.game==='race'?tracks:undefined};}
function send(r){io.to(r.id).emit('room:update',pub(r));}
function chessBotMove(r){
 if(r.game!=='chess')return;
 const chess=new Chess(r.state.fen);if(chess.isGameOver()||chess.turn()!=='b')return;
 const moves=chess.moves({verbose:true});if(!moves.length)return;
 const value={p:1,n:3,b:3,r:5,q:9,k:20};
 let chosen=moves[Math.floor(Math.random()*moves.length)];
 if(r.difficulty!=='easy'){
  const scored=moves.map(m=>({m,score:(m.captured?value[m.captured]:0)+(m.promotion?8:0)+(m.san.includes('+')?1:0)+(m.san.includes('#')?100:0)+(Math.random()*(r.difficulty==='hard'?.25:2))}));
  scored.sort((a,b)=>b.score-a.score);chosen=scored[0].m;
 }
 chess.move(chosen);
 r.state={fen:chess.fen(),turn:chess.turn(),moves:[...r.state.moves,chosen.san].slice(-16),status:chess.isCheckmate()?'Checkmate — AI wins':chess.isDraw()?'Draw':chess.isCheck()?'Check':'Playing'};
 send(r);
}
function pokerBotTurn(r){
 const active=r.bots[Math.floor(Math.random()*r.bots.length)];if(!active)return;
 const actions=r.difficulty==='easy'?['check','call','fold']:r.difficulty==='medium'?['check','call','bet']:['call','raise','bet'];
 const action=actions[Math.floor(Math.random()*actions.length)],amount=['bet','raise'].includes(action)?(r.difficulty==='hard'?30:10):0;
 r.state.pot+=amount;r.state.lastAction=active.name+' (AI) '+action+(amount?' '+amount:'');send(r);
}
function tickRace(r){
 if(r.game!=='race')return;
 const speed={easy:.012,medium:.019,hard:.027}[r.difficulty]||.019;
 for(let i=0;i<r.bots.length;i++){
  const id=r.bots[i].id,pos=r.state.racers[id]||{x:0,y:0,progress:0};
  pos.progress=(pos.progress||0)+speed*(.7+Math.random()*.6);
  pos.x=Math.sin(pos.progress*2)*.65;pos.y=Math.cos(pos.progress*1.3)*.5;r.state.racers[id]=pos;
 }
 send(r);
}
io.on('connection',socket=>{
 socket.on('room:create',({game,name,aiCount,difficulty},cb=()=>{})=>{
  if(!['poker','chess','race'].includes(game))return cb({ok:false,error:'Unknown game'});
  const id=Math.random().toString(36).slice(2,8).toUpperCase(),r=freshRoom(id,game,{aiCount,difficulty});
  rooms.set(id,r);join(r,socket,name);cb({ok:true,id,room:pub(r)});
  if(game==='race'){r.bots.forEach((b,i)=>r.state.racers[b.id]={x:0,y:0,progress:i*.3});}
  send(r);
 });
 socket.on('room:join',({id,name},cb=()=>{})=>{
  const r=rooms.get(String(id||'').toUpperCase());if(!r)return cb({ok:false,error:'Room not found'});
  if(r.players.length>=8)return cb({ok:false,error:'Room is full'});
  join(r,socket,name);cb({ok:true,room:pub(r)});
 });
 function join(r,s,n){if(r.players.some(p=>p.id===s.id))return;s.join(r.id);r.players.push({id:s.id,name:String(n||'Guest').slice(0,18)});if(r.game==='race')r.state.racers[s.id]={x:0,y:0,progress:0};send(r);}
 function leave(s){for(const r of rooms.values()){const n=r.players.length;r.players=r.players.filter(p=>p.id!==s.id);if(n!==r.players.length){delete r.state.racers[s.id];send(r);if(!r.players.length)rooms.delete(r.id);}}}
 socket.on('chess:move',({id,from,to,promotion})=>{
  const r=rooms.get(id);if(!r||r.game!=='chess'||!r.players.some(p=>p.id===socket.id))return;
  try{const chess=new Chess(r.state.fen);if(chess.turn()!=='w')return;const move=chess.move({from,to,promotion:promotion||'q'});if(!move)return;
   r.state={fen:chess.fen(),turn:chess.turn(),moves:[...r.state.moves,move.san].slice(-16),status:chess.isCheckmate()?'You win':chess.isDraw()?'Draw':chess.isCheck()?'Check':'AI thinking…'};send(r);
   if(!chess.isGameOver())setTimeout(()=>{if(rooms.has(id))chessBotMove(r);},r.difficulty==='hard'?850:500);
  }catch{}
 });
 socket.on('poker:action',({id,action,amount})=>{
  const r=rooms.get(id);if(!r||r.game!=='poker'||!r.players.some(p=>p.id===socket.id))return;
  const n=Math.max(0,Math.min(1000,Number(amount)||0));r.state.lastAction='You '+String(action).slice(0,12)+(n?' '+n:'');if(action==='bet'||action==='raise')r.state.pot+=n;send(r);
  setTimeout(()=>{if(rooms.has(id))pokerBotTurn(r);},700);
 });
 socket.on('race:move',({id,x,y})=>{
  const r=rooms.get(id);if(!r||r.game!=='race'||!r.state.racers[socket.id])return;
  const pos=r.state.racers[socket.id];pos.x=Math.max(-1,Math.min(1,Number(x)||0));pos.y=Math.max(-1,Math.min(1,Number(y)||0));pos.progress=(pos.progress||0)+.04;send(r);
 });
 socket.on('race:track',({id,track})=>{const r=rooms.get(id);if(r&&r.game==='race'&&r.players[0]?.id===socket.id){r.state.track=Math.max(1,Math.min(15,Number(track)||1));send(r);}});
 socket.on('disconnect',()=>leave(socket));
});
setInterval(()=>{for(const r of rooms.values())if(r.game==='race')tickRace(r);},900);
const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log('Webplace listening on '+port));
