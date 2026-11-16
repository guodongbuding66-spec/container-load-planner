import { guideCategories, guideTopics, type GuideCategory } from "./topics";

function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
}

const index = guideTopics.map(topic => ({
  topic,
  titles: topic.title.map(normalize),
  keywords: normalize(topic.keywords),
  body: normalize([...guideCategories[topic.category],...topic.path,...topic.steps.flat(),...(topic.tip??[])].join(" ")),
}));

export function searchGuide(query: string, category: GuideCategory | "all" = "all") {
  const phrase = normalize(query).replace(/^(?:请问)?(?:为什么|怎么|怎样|如何)(?:设置|使用|开启|打开)?\s*/u,"").replace(/\s*(?:教程|怎么用)$/u,"");
  const terms = phrase ? phrase.split(" ") : [];
  return index.flatMap(({topic,titles,keywords,body}) => {
    if (category!=="all" && topic.category!==category) return [];
    const scores = terms.map(term => titles.some(title=>title.includes(term)) ? 8 : keywords.includes(term) ? 5 : body.includes(term) ? 1 : 0);
    if (scores.includes(0)) return [];
    const phraseScore = phrase && titles.some(title=>title===phrase) ? 40
      : phrase && titles.some(title=>title.includes(phrase)) ? 20
      : phrase && keywords.includes(phrase) ? 12 : 0;
    return [{topic,score:phraseScore+scores.reduce<number>((sum,score)=>sum+score,0)}];
  }).sort((a,b)=>b.score-a.score).map(({topic})=>topic);
}
