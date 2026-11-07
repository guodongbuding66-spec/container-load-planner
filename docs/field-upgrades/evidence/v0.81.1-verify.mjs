// Run from the repository root with Node 24:
// node --experimental-transform-types --disable-warning=ExperimentalWarning docs/field-upgrades/evidence/v0.81.1-verify.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {registerHooks} from 'node:module';

registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      return next(specifier + '.ts', context);
    }
    throw error;
  }
}});
const {parseWorkspaceBackup, restoreWorkspacePlans} = await import('../../../lib/packing/workspace-file.ts');
const report = JSON.parse(readFileSync(new URL('./v0.81.1-acceptance.json', import.meta.url), 'utf8'));
const read = name => {
  const data = gunzipSync(readFileSync(new URL('./v0.81.1-' + name + '.gz', import.meta.url)));
  assert.equal(createHash('sha256').update(data).digest('hex'), report.sha256[name]);
  return data.toString('utf8');
};
const beforeText = read('main-before-16.json');
const before = parseWorkspaceBackup(beforeText);
const original = restoreWorkspacePlans(beforeText, before);
for (const strategy of ['practical', 'maximum']) {
  assert.equal(original.strategyPlans[strategy].metrics.loadedCount, 16);
  assert.equal(original.strategyPlans[strategy].pallets.length, 4);
}
const overlap = (a, b) => ['x', 'y', 'z'].every(k => Math.min(a[k] + a['d'+k], b[k] + b['d'+k]) - Math.max(a[k], b[k]) > 0.0001);
let verified = 0;
for (const [name, count, cap, layers] of [['main-322.json',322,23,12], ['main-112.json',112,20,4], ['main-280.json',280,20,10], ['gray-280.json',280,20,10]]) {
  const text = read(name), raw = JSON.parse(text), input = parseWorkspaceBackup(text), plan = restoreWorkspacePlans(text, input);
  assert.equal(raw.engineVersion, '0.81.1');
  const {palletBuild: oldBuild, ...oldInputs} = before;
  const {palletBuild: build, ...unchangedInputs} = input;
  assert.deepEqual(unchangedInputs, oldInputs);
  assert.equal(build.primaryRule.cartonLimit, cap);
  assert.equal(build.primaryRule.maxPallets, 50);
  assert.equal(build.maxPallets, oldBuild.maxPallets);
  assert.equal(input.products.reduce((n,p) => n + p.quantity, 0), 596);
  const c = build.config;
  assert.deepEqual([c.maxLoad,c.weight,c.height], [1000,25,25]);
  for (const strategy of ['practical', 'maximum']) {
    const result = plan.strategyPlans[strategy];
    assert.equal(result.validation.valid, true);
    assert.equal(result.metrics.loadedCount, count);
    assert.equal(result.pallets.length, 14);
    assert.equal(Math.max(...result.placements.map(b => b.layer)), layers);
    assert.equal(result.metrics.grossWeight, count * 42 + 14 * 25);
    for (const p of result.pallets) {
      const boxes = result.placements.filter(b => b.palletIds?.includes(p.id));
      assert.ok(boxes.length <= cap);
      assert.ok(boxes.reduce((n,b) => n + b.weight, 0) <= c.maxLoad);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.dx <= input.container.length - 2 * input.clearance + 0.0001 && p.y + p.dy <= input.container.width - 2 * input.clearance + 0.0001);
      assert.ok(p.enclosureHeight + input.clearance <= input.container.doorHeight + 0.0001);
      for (const b of boxes) {
        assert.ok(b.x >= p.x + 30 - 0.0001 && b.y >= p.y + 30 - 0.0001 && b.x + b.dx <= p.x + p.dx - 30 + 0.0001 && b.y + b.dy <= p.y + p.dy - 30 + 0.0001);
        assert.ok(b.z >= 25 - 0.0001 && b.z + b.dz <= p.enclosureHeight - 30 + 0.0001);
        if (b.z > 25 + 0.0001) assert.ok(boxes.some(a => Math.abs(a.x-b.x) < 0.0001 && Math.abs(a.y-b.y) < 0.0001 && Math.abs(a.z+a.dz-b.z) < 0.0001 && a.dx === b.dx && a.dy === b.dy));
      }
    }
    for (const list of [result.pallets, result.placements]) {
      for (let i=0; i<list.length; i++) for (let j=i+1; j<list.length; j++) assert.equal(overlap(list[i],list[j]), false);
    }
    verified++;
  }
}
assert.deepEqual(parseWorkspaceBackup(read('main-280.json')), parseWorkspaceBackup(read('gray-280.json')));
assert.deepEqual(JSON.parse(read('main-280.json')).coordinatePlans, JSON.parse(read('gray-280.json')).coordinatePlans);
console.log(`Verified ${verified} deployed plans, legacy 16-carton baseline, unchanged calculation inputs, SHA-256 and identical main/gray coordinates.`);
