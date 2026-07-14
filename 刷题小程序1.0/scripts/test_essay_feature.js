const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseEssayPaperMarkdown } = require('../admin/essay-parser');
const createEssayFeature = require('../cloudfunctions/admin/features/essay');

function createMemoryDb() {
  const collections = new Map();
  let clock = 0;
  const db = {
    serverDate: () => `server-date-${clock += 1}`,
    async createCollection(name) {
      if (collections.has(name)) throw new Error('collection already exists');
      collections.set(name, new Map());
    },
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
      const store = collections.get(name);
      const state = { where: null, order: null, skip: 0, limit: Infinity };
      const query = {
        doc(id) {
          return {
            async get() {
              if (!store.has(id)) throw new Error('not found');
              return { data: store.get(id) };
            },
            async update({ data }) {
              if (!store.has(id)) throw new Error('not found');
              store.set(id, { ...store.get(id), ...data });
            },
          };
        },
        async add({ data }) {
          if (store.has(data._id)) throw new Error('duplicate');
          store.set(data._id, { ...data });
        },
        where(where) { state.where = where; return query; },
        orderBy(field, direction) { state.order = { field, direction }; return query; },
        skip(value) { state.skip = value; return query; },
        limit(value) { state.limit = value; return query; },
        async get() {
          let list = Array.from(store.values());
          if (state.where) list = list.filter(item => Object.entries(state.where).every(([key, value]) => item[key] === value));
          if (state.order) list.sort((a, b) => {
            const result = Number(a[state.order.field] > b[state.order.field]) - Number(a[state.order.field] < b[state.order.field]);
            return state.order.direction === 'desc' ? -result : result;
          });
          return { data: list.slice(state.skip, state.skip + state.limit) };
        },
        async count() { return { total: store.size }; },
      };
      return query;
    },
  };
  return db;
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('用法: node scripts/test_essay_feature.js <申论真题.md>');
  const source = fs.readFileSync(input, 'utf8');
  const pkg = parseEssayPaperMarkdown(source, { filename: path.basename(input) });
  const feature = createEssayFeature({
    db: createMemoryDb(),
    ok: (data, message = 'ok') => ({ code: 0, data, message }),
    fail: (code, message, extra) => ({ code, message, ...(extra ? { extra } : {}) }),
  });

  const preview = await feature.previewEssayPackage({ package: pkg });
  assert.strictEqual(preview.code, 0);
  assert.strictEqual(preview.data.valid, true);

  const first = await feature.importEssayPackage({ package: pkg });
  assert.strictEqual(first.code, 0);
  assert.strictEqual(first.data.created, 15);
  assert.strictEqual(first.data.updated, 0);

  const second = await feature.importEssayPackage({ package: pkg });
  assert.strictEqual(second.code, 0);
  assert.strictEqual(second.data.created, 0);
  assert.strictEqual(second.data.updated, 15);

  const list = await feature.listEssayPapers({ page: 1, page_size: 20 });
  assert.strictEqual(list.data.total, 1);
  const detail = await feature.getEssayPaper({ paper_id: pkg.paper._id });
  assert.strictEqual(detail.data.materials.length, 4);
  assert.strictEqual(detail.data.questions.length, 5);
  assert.strictEqual(detail.data.answers.length, 5);
  const published = await feature.setEssayPaperStatus({ paper_id: pkg.paper._id, status: 'enabled' });
  assert.strictEqual(published.code, 0);
  assert.strictEqual(published.data.status, 'enabled');
  const publishedDetail = await feature.getEssayPaper({ paper_id: pkg.paper._id });
  assert.strictEqual(publishedDetail.data.paper.status, 'enabled');
  assert(publishedDetail.data.materials.every(item => item.status === 'enabled'));
  assert(publishedDetail.data.questions.every(item => item.status === 'enabled'));
  assert(publishedDetail.data.answers.every(item => item.status === 'enabled'));

  console.log(JSON.stringify({
    preview: preview.data.summary,
    first_import: first.data,
    second_import: second.data,
    detail: { materials: detail.data.materials.length, questions: detail.data.questions.length, answers: detail.data.answers.length },
    publish: published.data,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
