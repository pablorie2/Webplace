const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const {Chess}=require('chess.js');
const path=require('path');
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(req,res)=>res.json({ok:true,name:'Webplace'}));
const rooms=new Map();
const tracks=Array.from({length:15},(_,i)=>({id:i+1,name:['Coastal Sprint','Desert Loop','Alpine Pass','Neon Circuit','Forest Run'][i%5]}));
function freshRoom(id,game){return {id,game,players:[],created:Date.now(),state:game==='chess'?{fen:new Chess().fen(),turn:'w',moves:[]}:game==='poker'?{pot:0,round:'Waiting',cards:{},bets:{}}:{track:1,racers:{},started:false}}}
function pub(r){return {id:r.id,game:r.game,players:r.players.map(p=>({id:p.id,name:p.name})),state:r.state,tracks:r.game==='race'?tracks:undefined};}
function send(r){io.to(r.id).emit('room:update',pub(r));}
io.on('connection',socket=>{
 socket.on('room:create',({game,name},cb={})=>{if(!['poker','chess','race'].includes(game))return;const id=Math.random().toString(36).slice(2,8).toUpperCase();const r=freshRoom(id,game);rooms.set(id,r);join(r,socket,name);cb({ok:true,id,room:pub(r)});});
 socket.on('room:join',({id,name},cb={})=>{const r=rooms.get(String(id||'').toUpperCase());if(!r)return cb({ok:false,error:'Room not found'});join(r,socket,name);cb({ok:true,room:pub(r)});});
 function join(r,s,n){if(r.players.length>=8&&!r.players.some(p=>p.id===s.id))return;leave(s);s.join(r.id);r.players.push({id:s.id,name:String(n||'Guest').slice(0,18)});if(r.game==='race')r.state.racers[s.id]={x:0,y:0,lap:0};send(r);}
 function leave(s){for(const r of rooms.values()){const n=r.players.length;r.players=r.players.filter(p=>p.id!==s.id);if(n!==r.players.length){delete r.state.racers?.[s.id];send(r);if(!r.players.length)rooms.delete(r.id);}}}
 socket.on('chess:move',({id,from,to,promotion})=>{const r=rooms.get(id);if(!r||r.game!=='chess'||r.players.length<1)return;try{const chess=new Chess(r.state.fen);const player=r.players.findIndex(p=>p.id===socket.id);if(player<0||((chess.turn()==='w'?0:1)!==player))return;const move=chess.move({from,to,promotion:promotion||'q'});if(move){r.state={fen:chess.fen(),turn:chess.turn(),moves:[...r.state.moves,move.san].slice(-12),status:chess.isCheckmate()?'Checkmate':chess.isDraw()?'Draw':chess.isCheck()?'Check':'Playing'};send(r);}}catch{}});
 socket.on('poker:action',({id,action,amount})=>{const r=rooms.get(id);if(!r||r.game!=='poker')return;const p=r.players.find(x=>x.id===socket.id);if(!p)return;const n=Math.max(0,Math.min(1000,Number(amount)||0));r.state.lastAction=p.name+' '+String(action).slice(0,12)+(n?' '+n:'');if(action==='bet'||action==='raise')r.state.pot+=n;send(r);});
 socket.on('race:move',({id,x,y})=>{const r=rooms.get(id);if(!r||r.game!=='race'||!r.state.racers[socket.id])return;r.state.racers[socket.id]={x:Math.max(-1,Math.min(1,Number(x)||0)),y:Math.max(-1,Math.min(1,Number(y)||0))};socket.to(id).emit('race:positions',r.state.racers);});
 socket.on('race:track',({id,track})=>{const r=rooms.get(id);if(r&&r.game==='race'&&r.players[0]?.id===socket.id){r.state.track=Math.max(1,Math.min(15,Number(track)||1));send(r);}});
 socket.on('disconnect',()=>leave(socket));
});
const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log('Webplace listening on '+port));