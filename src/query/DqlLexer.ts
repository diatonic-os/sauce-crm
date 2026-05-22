export type DqlTok =
  | { kind: "kw"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "str"; value: string }
  | { kind: "num"; value: number }
  | { kind: "op"; value: string }
  | { kind: "wikilink"; target: string }
  | { kind: "punct"; value: string };

const KEYWORDS = new Set([
  "TABLE","LIST","TASK","FROM","WHERE","SORT","ASC","DESC","GROUP","BY","FLATTEN","LIMIT",
  "PATH","TO","OVER","MAXIMIZE","MINIMIZE",
  "COMPATIBLE","WITH","DENSITY",
  "GRAPH","NODES","EDGES","COLOR",
  "HEATMAP","MATRIX",
  "AND","OR","NOT","IN",
]);

export function lexDql(src: string): DqlTok[] {
  const out: DqlTok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1; let v = "";
      while (j < src.length && src[j] !== q) { v += src[j]; j++; }
      out.push({ kind: "str", value: v });
      i = j + 1; continue;
    }
    if (c === "[" && src[i + 1] === "[") {
      const end = src.indexOf("]]", i + 2);
      if (end === -1) throw new Error("unterminated wikilink");
      out.push({ kind: "wikilink", target: src.slice(i + 2, end) });
      i = end + 2; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i; while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      out.push(KEYWORDS.has(word.toUpperCase()) ? { kind: "kw", value: word.toUpperCase() } : { kind: "ident", value: word });
      i = j; continue;
    }
    if (",;()".includes(c)) { out.push({ kind: "punct", value: c }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (["==","!=","<=",">=","&&","||"].includes(two)) { out.push({ kind: "op", value: two }); i += 2; continue; }
    if ("=<>+-*/!".includes(c)) { out.push({ kind: "op", value: c }); i++; continue; }
    if (c === "∋") { out.push({ kind: "op", value: "∋" }); i++; continue; }
    if (c === "∈") { out.push({ kind: "op", value: "∈" }); i++; continue; }
    // skip unknown
    i++;
  }
  return out;
}
