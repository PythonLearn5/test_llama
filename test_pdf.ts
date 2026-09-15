import { SimpleDirectoryReader } from "@llamaindex/readers/directory";

async function test() {
  const reader = new SimpleDirectoryReader();
  const docs = await reader.loadData("data");
  const attentionDocs = docs.filter(d => (d.metadata?.file_name || "").includes("attention"));

  console.log(`Attention paper pages: ${attentionDocs.length}\n`);

  // Mark pages with table/figure content
  attentionDocs.forEach((doc, i) => {
    const text = doc.text || "";
    const hasTable = /table|TABLE|BLEU|complexity|Sequential/i.test(text);
    const hasFigure = /figure|FIGURE|scaled dot-product|multi-head/i.test(text);
    const flag = hasTable && hasFigure ? "[TABLE+FIG]" : hasTable ? "[TABLE]" : hasFigure ? "[FIG]" : "";
    console.log(`--- Page ${i + 1} ${flag} (${text.length} chars) ---`);
    console.log(text.substring(0, 150).replace(/\n/g, " "));
    console.log("");
  });
}

test();
