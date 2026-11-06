import { palletizeThenPack } from "./palletize";
import { previewPalletRecipe } from "./pallet-recipe";

self.onmessage = e => {
  try {
    const {request, config, mix, limit, build, recipe} = e.data;
    const result = recipe ? previewPalletRecipe(recipe) : palletizeThenPack(request, config, mix, limit, build);
    self.postMessage({ok:true, result});
  } catch (e) {
    self.postMessage({ok:false, error:e instanceof Error ? e.message : String(e)});
  }
};
