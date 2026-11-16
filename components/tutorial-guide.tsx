"use client";

import { useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { guideCategories, type GuideCategory, type GuideTarget } from "../lib/help/topics";
import { searchGuide } from "../lib/help/search";
import { tr, useLanguage } from "./language";

const popular = [
  ["几箱一托","Cartons per pallet"],
  ["只装一层","One layer"],
  ["托脚","Pallet feet"],
  ["孤立整托","Isolate pallet"],
  ["唛头","Shipping mark"],
  ["多柜","Multi-container"],
] as const;

export function TutorialGuide({initialTopic="",onNavigate}:{initialTopic?:string;onNavigate:(target:GuideTarget)=>string|undefined}) {
  useLanguage();
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState<GuideCategory|"all">("all");
  const [selected,setSelected] = useState(initialTopic);
  const [notice,setNotice] = useState("");
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const matches = searchGuide(query,category);
  const article = matches.find(topic=>topic.id===selected)??matches[0];
  const updateQuery = (value:string) => {
    setQuery(value);
    setCategory("all");
    setSelected("");
    setNotice("");
  };
  return <div className="tutorial-guide">
    <div className="tutorial-search">
      <label htmlFor="guide-query">{tr("搜索功能教程","Search tutorials")}</label>
      <div className="tutorial-search-field">
        <Search size={17} aria-hidden="true"/>
        <input type="search" id="guide-query" value={query} maxLength={120} data-dialog-autofocus={!initialTopic?"":undefined}
          onChange={e=>updateQuery(e.target.value)} placeholder={tr("输入功能名或遇到的问题","Enter a feature or a problem")}/>
      </div>
      <div className="tutorial-search-suggestions" role="group" aria-label={tr("常用搜索词","Popular searches")}>
        {popular.map(words=><button key={words[0]} type="button" className="button small" onClick={()=>updateQuery(tr(words[0],words[1]))}>{tr(words[0],words[1])}</button>)}
      </div>
    </div>
    <div className="tutorial-categories" role="group" aria-label={tr("教程分类","Tutorial categories")}>
      {([["all",["全部","All"]], ...Object.entries(guideCategories)] as readonly [GuideCategory|"all",readonly [string,string]][])
        .map(([key,label])=><button key={key} type="button" className="button small" aria-pressed={key===category} onClick={()=>{setCategory(key);setSelected("");setNotice("");}}>{tr(...label)}</button>)}
    </div>
    <p className="tutorial-match-count" role="status">{tr(`${matches.length} 篇教程`,`${matches.length} tutorials`)}</p>
    {article
      ? <div className={matches.length===1?"tutorial-content tutorial-content-single":"tutorial-content"}>
        {matches.length>1&&<nav className="tutorial-results" aria-label={tr("匹配教程","Matching tutorials")}>
          <ul>{matches.map(topic=><li key={topic.id}>
            <button type="button" aria-current={topic.id===article.id?"true":undefined} onClick={()=>{
              setSelected(topic.id);
              setNotice("");
              articleHeading.current?.focus({preventScroll:true});
              articleHeading.current?.scrollIntoView({block:"nearest"});
            }}>
              <span>{tr(...topic.title)}</span><ArrowRight size={14} aria-hidden="true"/>
            </button>
          </li>)}</ul>
        </nav>}
        <article className="tutorial-article" aria-labelledby="tutorial-article-title">
          <h3 id="tutorial-article-title" ref={articleHeading} tabIndex={-1}>{tr(...article.title)}</h3>
          <p className="tutorial-path">{tr(...article.path)}</p>
          <ol>{article.steps.map(step=><li key={step[0]}>{tr(...step)}</li>)}</ol>
          {article.tip&&<p className="tutorial-tip">{tr(...article.tip)}</p>}
          <button type="button" className="button primary" onClick={()=>setNotice(onNavigate(article.target)??"")}>
            {tr("前往功能入口","Go to feature")}<ArrowRight size={16} aria-hidden="true"/>
          </button>
          {notice&&<p className="tutorial-notice" role="status">{notice}</p>}
        </article>
      </div>
      : <div className="tutorial-empty">
        <strong>{tr("没有匹配的教程","No matching tutorials")}</strong>
        <p>{tr("试试控件名称、较短的关键词或上方的常用搜索词。","Try a control name, a shorter keyword or one of the popular searches.")}</p>
        <button className="button small" type="button" onClick={()=>updateQuery("")}>{tr("查看全部教程","Show all tutorials")}</button>
      </div>}
  </div>;
}
