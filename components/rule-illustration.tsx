export function RuleIllustration({group,value}:{group:"layout"|"search"|"cargoOrder";value:string}) {
  const colors=["#8bbfc6","#5fa3af","#328494"];
  if(group==="cargoOrder"){
    const heights=value==="small-first"?[12,22,34]:value==="large-first"?[34,22,12]:[22,34,12];
    return <svg viewBox="0 0 120 60" aria-hidden="true"><path d="M8 48H112" stroke="#b5cbd1"/>{heights.map((h,i)=><rect key={i} x={15+i*32} y={48-h} width={24} height={h} rx={2} fill={colors[i]}/>)}<path d="M24 55H95L89 52M95 55L89 58" fill="none" stroke="#678e9b" strokeWidth={1.5}/></svg>;
  }
  if(group==="search")return <svg viewBox="0 0 120 60" aria-hidden="true"><path d="M15 14H105V48H15Z" fill="#f0f7f8" stroke="#b3cbd1"/>{Array.from({length:value==="deep"?15:8},(_,i)=><rect key={i} x={20+(i%5)*17} y={19+Math.floor(i/5)*9} width={14} height={6} rx={1} fill={colors[i%3]}/>)}<circle cx={88} cy={34} r={12} fill="#fff" fillOpacity={.7} stroke="#317f90" strokeWidth={2}/><path d="M97 43L108 54" stroke="#317f90" strokeWidth={3}/></svg>;
  return <svg viewBox="0 0 120 60" aria-hidden="true"><path d="M10 15H110V46H10Z" fill="#f3f8f9" stroke="#afc7ce"/>{Array.from({length:10},(_,i)=>{
    const vertical=value==="deep-first",x=vertical?15+Math.floor(i/2)*18:15+(i%5)*18,y=vertical?20+(i%2)*11:20+Math.floor(i/5)*11;
    const fill=value==="auto"?colors[(i+Math.floor(i/5))%3]:colors[vertical?Math.floor(i/2)%3:Math.floor(i/5)%3];
    return <rect key={i} x={x} y={y} width={15} height={8} rx={1} fill={fill}/>;
  })}<path d={value==="layers"?"M6 47V17L3 23M6 17L9 23":"M15 54H105L99 51M105 54L99 57"} stroke="#678e9b" strokeWidth={1.5} fill="none"/></svg>;
}
