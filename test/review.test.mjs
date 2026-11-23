import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../lib/export.js';
import { exportReady, missingFields, reviewFieldsComplete, selectExportRows, unverifiedFields, toggleVisibleSelection } from '../lib/review.js';
const item = { id:1, price:100, title:'Synthetic boot', brand:'Ariat', sized_for:'Men', condition:'New',
  size:'10.5',width:'D',id_text:'TEST-ONLY',photos:['https://example.invalid/test.jpg'],guessed:[] };
test('complete unapproved fields never show ready to export',()=>{
  assert.equal(reviewFieldsComplete(item),true);
  assert.equal(exportReady(item),false);
  assert.equal(exportReady({...item,approved_at:'2026-11-03'}),true);
  assert.equal(exportReady({...item,approved_at:'2026-11-03',guessed:['brand']}),false);
  assert.equal(exportReady({...item,approved_at:'2026-11-03',photos:[]}),false);
  assert.deepEqual(missingFields({...item,brand:'  '}),['brand']);
  assert.deepEqual(unverifiedFields({...item,guessed:['brand','width'],width:''}),['brand']);
});
test('select rejected or filtered items without selecting hidden or other-group items',()=>{
  const selected=new Set([1,9]);
  const visible=[{id:2},{id:3}];
  const next=toggleVisibleSelection(selected,visible);
  assert.deepEqual([...next],[1,9,2,3]);assert.deepEqual([...selected],[1,9]);
  assert.deepEqual([...toggleVisibleSelection(next,visible)],[1,9]);
  assert.deepEqual([...toggleVisibleSelection(new Set([1,2,9]),visible)],[1,2,9,3]);
  assert.deepEqual([...toggleVisibleSelection(selected,[])],[1,9]);
});

test('CSV selection excludes fully verified but unapproved rows and counts export exceptions', () => {
  const approved = { ...item, id: 2, approved_at: '2026-11-03' };
  const exception = { ...approved, id: 3, width: '' };
  const hidden = { ...approved, id: 4 };
  const items = [item, approved, exception, hidden];
  const result = selectExportRows(items, new Set([1, 2, 3]));
  assert.deepEqual(result.picked.map(i => i.id), [1, 2, 3]);
  assert.deepEqual(result.rows.map(i => i.id), [2, 3]);
  assert.equal(result.notReady, 1);
  assert.deepEqual(selectExportRows(items, new Set([1])).rows, []);
});

test('review-selected data produces a stable synthetic CSV row only after approval', () => {
  const waiting = { ...item, title: 'Unapproved synthetic boot' };
  const approved = { ...item, id: 2, approved_at: '2026-11-03', title: 'Approved synthetic boot',
    seller: 'synthetic-seller', source_id: 'synthetic-2', boot: 'boot', size: '10.5', width: 'D' };
  const build = () => toCsv(selectExportRows([waiting, approved], new Set([1, 2])).rows,
    { origin: 'https://example.invalid' });
  const csv = build();
  const [headers, exported] = csv.split('\r\n');
  assert.match(headers, /"Listing title","Asking price"/);
  assert.match(headers, /"WBW Seller Name".*"Source ID"$/);
  assert.match(exported, /"Approved synthetic boot","100"/);
  assert.match(exported, /synthetic-seller.*synthetic-2/);
  assert.doesNotMatch(csv, /Unapproved synthetic boot/);
  assert.equal(build(), csv);
});
