import type { Root, RootContent, PhrasingContent } from "mdast";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

function spokenNode(node: Root | RootContent | PhrasingContent): string {
  switch (node.type) {
    case "code":
    case "html":
    case "image":
    case "imageReference":
    case "definition":
    case "footnoteDefinition":
    case "footnoteReference":
    case "table":
    case "thematicBreak":
      return "";
    case "text":
    case "inlineCode":
      return node.value;
    case "break":
      return " ";
    default: {
      const children = "children" in node ? node.children.map(spokenNode).join("") : "";
      return ["heading", "paragraph", "listItem", "blockquote"].includes(node.type)
        ? `${children}\n`
        : children;
    }
  }
}

const englishWords = new Set(
  "the and is are was were to of in that it for with as on be this have not you but they from or by at an we can will your which their if has do so what about would there when more".split(
    " ",
  ),
);
const germanWords = new Set(
  "der die das und ist sind war waren zu von in dass es für mit als auf sein nicht sie aber ein eine einen wir kann wird ihr ihre den dem des auch wie wenn oder nach bei noch nur über schon mehr sich".split(
    " ",
  ),
);

/**
 * Picks English or German for a message by counting common words of each language.
 * Umlauts and ß count as extra German evidence. Ties and text without evidence read as English.
 */
export function detectReadAloudLanguage(text: string): "en" | "de" {
  let english = 0;
  let german = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (englishWords.has(word)) english++;
    if (germanWords.has(word)) german++;
    if (/[äöüß]/.test(word)) german++;
  }
  return german > english ? "de" : "en";
}

export function readAloudText(markdown: string): string {
  return spokenNode(parser.parse(markdown))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
