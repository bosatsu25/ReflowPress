import {
  DOMParser,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";

export function containsDoctype(source: string): boolean {
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end === -1) return false;
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index + 2);
      if (end === -1) return false;
      index = end + 2;
      continue;
    }
    return (
      source.startsWith("<!DOCTYPE", index) &&
      /\s/.test(source[index + 9] ?? "")
    );
  }

  return false;
}

export function parseXml<E extends Error>(
  source: string,
  createError: (message: string, cause?: unknown) => E,
): Document {
  // DTDs are not permitted in EPUB metadata or content parsing to prevent entity expansion / SSRF.
  if (containsDoctype(source)) {
    throw createError("Document type declarations are not supported.");
  }

  const errors: string[] = [];
  let document: Document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level === "error" || level === "fatalError") errors.push(message);
      },
    }).parseFromString(source, "application/xml");
  } catch (cause) {
    throw createError("The XML document is malformed.", cause);
  }

  if (errors.length > 0 || document.documentElement === null) {
    throw createError("The XML document is malformed.");
  }
  return document;
}

export function firstDirectChild(
  parent: Element,
  localName: string,
): Element | undefined {
  return directChildren(parent, localName)[0];
}

export function directChildren(parent: Element, localName: string): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child: Node | null = parent.childNodes.item(index);
    if (child?.nodeType === 1 && (child as Element).localName === localName) {
      children.push(child as Element);
    }
  }
  return children;
}

export function requiredAttribute<E extends Error>(
  element: Element,
  name: string,
  createError: (message: string) => E,
): string {
  const value = element.getAttribute(name)?.trim();
  if (!value) throw createError(`Element requires attribute ${name}.`);
  return value;
}
