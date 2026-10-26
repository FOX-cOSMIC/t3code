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

export function readAloudText(markdown: string): string {
  return spokenNode(parser.parse(markdown))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
