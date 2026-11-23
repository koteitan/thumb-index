# thumb-index

辞書の小口インデックスをパラパラめくる感覚で scrapbox.io/nostr のページを引く索引。

- `index.html` / `style.css` / `main.js` — 画面。`pages.js` だけを読む (fetch しないので file:// でも動く)
- `pages.js` — 索引データ (生成物)
- `build-index.mjs` — scrapbox API から全タイトルを取り、辞書順に並べて `pages.js` を書く
- `yomi.tsv` — 漢字タイトルの読みの上書き (mecab の誤読・固有名詞)。読みは見出しに【よみ】として表示される
- `.github/workflows/deploy.yml` — 毎日と push 時に索引を作り直して Pages に上げる。各ファイルの URL に内容のハッシュ (`?v=`) を、`<meta name="version">` にコミット ID を入れる

## 索引の更新

```sh
node build-index.mjs            # nostr プロジェクト → pages.js
node build-index.mjs myproj     # 別プロジェクト
SCRAPBOX_SID=... node build-index.mjs privateproj   # private プロジェクトのみ connect.sid が必要
```

scrapbox API は CORS ヘッダを返さないため、ブラウザから直接は取れない。ビルド時に取得して `pages.js` に焼き込む。
`SCRAPBOX_SID` は取得時のリクエストにだけ使い、`pages.js` には入らない。

## 並び順

`#` (数字) → A–Z → あ か さ た な は ま や ら わ。漢字は mecab の読みで仮名の行に入る。
【完了】などの先頭タグと記号は並べ替えでは無視する。
