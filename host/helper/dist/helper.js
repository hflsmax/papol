// Built by `npm run build` in host/helper from src/ and cloudflare/src/papers/tei.ts. Do not edit.

// src/server.ts
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

// src/files.ts
import { createHash } from "node:crypto";

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/StringScanner.js
var emptyString = "";
var surrogatePair = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
var StringScanner = class {
  constructor(string) {
    this.charCount = this.charLength(string, true);
    this.charIndex = 0;
    this.length = string.length;
    this.multiByteMode = this.charCount !== this.length;
    this.string = string;
    if (this.multiByteMode) {
      let charsToBytes = [];
      for (let byteIndex = 0, charIndex = 0; charIndex < this.charCount; ++charIndex) {
        charsToBytes[charIndex] = byteIndex;
        byteIndex += string.codePointAt(byteIndex) > 65535 ? 2 : 1;
      }
      this.charsToBytes = charsToBytes;
    }
  }
  /**
   * Whether the current character index is at the end of the input string.
   */
  get isEnd() {
    return this.charIndex >= this.charCount;
  }
  // -- Protected Methods ------------------------------------------------------
  /**
   * Returns the number of characters in the given string, which may differ from
   * the byte length if the string contains multibyte characters.
   */
  charLength(string, multiByteSafe = this.multiByteMode) {
    return multiByteSafe ? string.replace(surrogatePair, "_").length : string.length;
  }
  // -- Public Methods ---------------------------------------------------------
  /**
   * Advances the scanner by the given number of characters, stopping if the end
   * of the string is reached.
   */
  advance(count = 1) {
    this.charIndex = Math.min(this.charCount, this.charIndex + count);
  }
  /**
   * Returns the byte index of the given character index in the string. The two
   * may differ in strings that contain multibyte characters.
   */
  charIndexToByteIndex(charIndex = this.charIndex) {
    return this.multiByteMode ? this.charsToBytes[charIndex] ?? Infinity : charIndex;
  }
  /**
   * Consumes and returns the given number of characters if possible, advancing
   * the scanner and stopping if the end of the string is reached.
   *
   * If no characters could be consumed, an empty string will be returned.
   */
  consume(charCount = 1) {
    let chars = this.peek(charCount);
    this.advance(charCount);
    return chars;
  }
  /**
   * Consumes and returns the given number of bytes if possible, advancing the
   * scanner and stopping if the end of the string is reached.
   *
   * It's up to the caller to ensure that the given byte count doesn't split a
   * multibyte character.
   *
   * If no bytes could be consumed, an empty string will be returned.
   */
  consumeBytes(byteCount) {
    let byteIndex = this.charIndexToByteIndex();
    let result = this.string.slice(byteIndex, byteIndex + byteCount);
    this.advance(this.charLength(result));
    return result;
  }
  /**
   * Consumes and returns all characters for which the given function returns
   * `true`, stopping when `false` is returned or the end of the input is
   * reached.
   */
  consumeMatchFn(fn) {
    let { length, multiByteMode, string } = this;
    let startByteIndex = this.charIndexToByteIndex();
    let endByteIndex = startByteIndex;
    if (multiByteMode) {
      while (endByteIndex < length) {
        let char = string[endByteIndex];
        let isSurrogatePair = char >= "\uD800" && char <= "\uDBFF";
        if (isSurrogatePair) {
          char += string[endByteIndex + 1];
        }
        if (!fn(char)) {
          break;
        }
        endByteIndex += isSurrogatePair ? 2 : 1;
      }
    } else {
      while (endByteIndex < length && fn(string[endByteIndex])) {
        ++endByteIndex;
      }
    }
    return this.consumeBytes(endByteIndex - startByteIndex);
  }
  /**
   * Consumes the given string if it exists at the current character index, and
   * advances the scanner.
   *
   * If the given string doesn't exist at the current character index, an empty
   * string will be returned and the scanner will not be advanced.
   */
  consumeString(stringToConsume) {
    let { length } = stringToConsume;
    let byteIndex = this.charIndexToByteIndex();
    if (stringToConsume === this.string.slice(byteIndex, byteIndex + length)) {
      this.advance(length === 1 ? 1 : this.charLength(stringToConsume));
      return stringToConsume;
    }
    return emptyString;
  }
  /**
   * Consumes characters until the given global regex is matched, advancing the
   * scanner up to (but not beyond) the beginning of the match. If the regex
   * doesn't match, nothing will be consumed.
   *
   * Returns the consumed string, or an empty string if nothing was consumed.
   */
  consumeUntilMatch(regex) {
    let matchByteIndex = this.string.slice(this.charIndexToByteIndex()).search(regex);
    return matchByteIndex > 0 ? this.consumeBytes(matchByteIndex) : emptyString;
  }
  /**
   * Consumes characters until the given string is found, advancing the scanner
   * up to (but not beyond) that point. If the string is never found, nothing
   * will be consumed.
   *
   * Returns the consumed string, or an empty string if nothing was consumed.
   */
  consumeUntilString(searchString) {
    let byteIndex = this.charIndexToByteIndex();
    let matchByteIndex = this.string.indexOf(searchString, byteIndex);
    return matchByteIndex > 0 ? this.consumeBytes(matchByteIndex - byteIndex) : emptyString;
  }
  /**
   * Returns the given number of characters starting at the current character
   * index, without advancing the scanner and without exceeding the end of the
   * input string.
   */
  peek(count = 1) {
    let { charIndex, string } = this;
    return this.multiByteMode ? string.slice(this.charIndexToByteIndex(charIndex), this.charIndexToByteIndex(charIndex + count)) : string.slice(charIndex, charIndex + count);
  }
  /**
   * Resets the scanner position to the given character _index_, or to the start
   * of the input string if no index is given.
   *
   * If _index_ is negative, the scanner position will be moved backward by that
   * many characters, stopping if the beginning of the string is reached.
   */
  reset(index = 0) {
    this.charIndex = index >= 0 ? Math.min(this.charCount, index) : Math.max(0, this.charIndex + index);
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/syntax.js
var attValueCharDoubleQuote = /["&<]/;
var attValueCharSingleQuote = /['&<]/;
var attValueNormalizedWhitespace = /\r\n|[\n\r\t]/g;
var endCharData = /<|&|]]>/;
var predefinedEntities = Object.freeze(Object.assign(/* @__PURE__ */ Object.create(null), {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
}));
function isNameChar(char) {
  let cp = char.codePointAt(0);
  return cp >= 97 && cp <= 122 || cp >= 65 && cp <= 90 || cp >= 48 && cp <= 57 || cp === 45 || cp === 46 || cp === 183 || cp >= 768 && cp <= 879 || cp === 8255 || cp === 8256 || isNameStartChar(char, cp);
}
function isNameStartChar(char, cp = char.codePointAt(0)) {
  return cp >= 97 && cp <= 122 || cp >= 65 && cp <= 90 || cp === 58 || cp === 95 || cp >= 192 && cp <= 214 || cp >= 216 && cp <= 246 || cp >= 248 && cp <= 767 || cp >= 880 && cp <= 893 || cp >= 895 && cp <= 8191 || cp === 8204 || cp === 8205 || cp >= 8304 && cp <= 8591 || cp >= 11264 && cp <= 12271 || cp >= 12289 && cp <= 55295 || cp >= 63744 && cp <= 64975 || cp >= 65008 && cp <= 65533 || cp >= 65536 && cp <= 983039;
}
function isReferenceChar(char) {
  return char === "#" || isNameChar(char);
}
function isWhitespace(char) {
  let cp = char.codePointAt(0);
  return cp === 32 || cp === 9 || cp === 10 || cp === 13;
}
function isXmlCodePoint(cp) {
  return cp >= 32 && cp <= 55295 || cp === 10 || cp === 9 || cp === 13 || cp >= 57344 && cp <= 65533 || cp >= 65536 && cp <= 1114111;
}

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlNode.js
var XmlNode = class _XmlNode {
  constructor() {
    this.parent = null;
    this.start = -1;
    this.end = -1;
  }
  /**
   * Document that contains this node, or `null` if this node is not associated
   * with a document.
   */
  get document() {
    return this.parent?.document ?? null;
  }
  /**
   * Whether this node is the root node of the document (also known as the
   * document element).
   */
  get isRootNode() {
    return this.parent !== null && this.parent === this.document && this.type === _XmlNode.TYPE_ELEMENT;
  }
  /**
   * Whether whitespace should be preserved in the content of this element and
   * its children.
   *
   * This is influenced by the value of the special `xml:space` attribute, and
   * will be `true` for any node whose `xml:space` attribute is set to
   * "preserve". If a node has no such attribute, it will inherit the value of
   * the nearest ancestor that does (if any).
   *
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#sec-white-space
   */
  get preserveWhitespace() {
    return !!this.parent?.preserveWhitespace;
  }
  /**
   * Type of this node.
   *
   * The value of this property is a string that matches one of the static
   * `TYPE_*` properties on the `XmlNode` class (e.g. `TYPE_ELEMENT`,
   * `TYPE_TEXT`, etc.).
   *
   * The `XmlNode` class itself is a base class and doesn't have its own type
   * name.
   */
  get type() {
    return "";
  }
  /**
   * Returns a JSON-serializable object representing this node, minus properties
   * that could result in circular references.
   */
  toJSON() {
    let json = {
      type: this.type
    };
    if (this.isRootNode) {
      json.isRootNode = true;
    }
    if (this.preserveWhitespace) {
      json.preserveWhitespace = true;
    }
    if (this.start !== -1) {
      json.start = this.start;
      json.end = this.end;
    }
    return json;
  }
};
XmlNode.TYPE_CDATA = "cdata";
XmlNode.TYPE_COMMENT = "comment";
XmlNode.TYPE_DOCUMENT = "document";
XmlNode.TYPE_DOCUMENT_TYPE = "doctype";
XmlNode.TYPE_ELEMENT = "element";
XmlNode.TYPE_PROCESSING_INSTRUCTION = "pi";
XmlNode.TYPE_TEXT = "text";
XmlNode.TYPE_XML_DECLARATION = "xmldecl";

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlText.js
var XmlText = class extends XmlNode {
  constructor(text2 = "") {
    super();
    this.text = text2;
  }
  get type() {
    return XmlNode.TYPE_TEXT;
  }
  toJSON() {
    return Object.assign(XmlNode.prototype.toJSON.call(this), {
      text: this.text
    });
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlCdata.js
var XmlCdata = class extends XmlText {
  get type() {
    return XmlNode.TYPE_CDATA;
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlComment.js
var XmlComment = class extends XmlNode {
  constructor(content = "") {
    super();
    this.content = content;
  }
  get type() {
    return XmlNode.TYPE_COMMENT;
  }
  toJSON() {
    return Object.assign(XmlNode.prototype.toJSON.call(this), {
      content: this.content
    });
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlDeclaration.js
var XmlDeclaration = class extends XmlNode {
  constructor(version, encoding, standalone) {
    super();
    this.version = version;
    this.encoding = encoding ?? null;
    this.standalone = standalone ?? null;
  }
  get type() {
    return XmlNode.TYPE_XML_DECLARATION;
  }
  toJSON() {
    let json = XmlNode.prototype.toJSON.call(this);
    json.version = this.version;
    for (let key of ["encoding", "standalone"]) {
      if (this[key] !== null) {
        json[key] = this[key];
      }
    }
    return json;
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlElement.js
var XmlElement = class _XmlElement extends XmlNode {
  constructor(name, attributes = /* @__PURE__ */ Object.create(null), children2 = []) {
    super();
    this.name = name;
    this.attributes = attributes;
    this.children = children2;
  }
  /**
   * Whether this element is empty (meaning it has no children).
   */
  get isEmpty() {
    return this.children.length === 0;
  }
  get preserveWhitespace() {
    let node = this;
    while (node instanceof _XmlElement) {
      if ("xml:space" in node.attributes) {
        return node.attributes["xml:space"] === "preserve";
      }
      node = node.parent;
    }
    return false;
  }
  /**
   * Text content of this element and all its descendants.
   */
  get text() {
    return this.children.map((child) => "text" in child ? child.text : "").join("");
  }
  get type() {
    return XmlNode.TYPE_ELEMENT;
  }
  toJSON() {
    return Object.assign(XmlNode.prototype.toJSON.call(this), {
      name: this.name,
      attributes: this.attributes,
      children: this.children.map((child) => child.toJSON())
    });
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlDocument.js
var XmlDocument = class extends XmlNode {
  constructor(children2 = []) {
    super();
    this.children = children2;
  }
  get document() {
    return this;
  }
  /**
   * Root element of this document, or `null` if this document is empty.
   */
  get root() {
    for (let child of this.children) {
      if (child instanceof XmlElement) {
        return child;
      }
    }
    return null;
  }
  /**
   * Text content of this document and all its descendants.
   */
  get text() {
    return this.children.map((child) => "text" in child ? child.text : "").join("");
  }
  get type() {
    return XmlNode.TYPE_DOCUMENT;
  }
  toJSON() {
    return Object.assign(XmlNode.prototype.toJSON.call(this), {
      children: this.children.map((child) => child.toJSON())
    });
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlDocumentType.js
var XmlDocumentType = class extends XmlNode {
  constructor(name, publicId, systemId, internalSubset) {
    super();
    this.name = name;
    this.publicId = publicId ?? null;
    this.systemId = systemId ?? null;
    this.internalSubset = internalSubset ?? null;
  }
  get type() {
    return XmlNode.TYPE_DOCUMENT_TYPE;
  }
  toJSON() {
    let json = XmlNode.prototype.toJSON.call(this);
    json.name = this.name;
    for (let key of ["publicId", "systemId", "internalSubset"]) {
      if (this[key] !== null) {
        json[key] = this[key];
      }
    }
    return json;
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlError.js
var XmlError = class extends Error {
  constructor(message, charIndex, xml) {
    let column = 1;
    let excerpt = "";
    let line = 1;
    for (let i = 0; i < charIndex; ++i) {
      let char = xml[i];
      if (char === "\n") {
        column = 1;
        excerpt = "";
        line += 1;
      } else {
        column += 1;
        excerpt += char;
      }
    }
    let eol = xml.indexOf("\n", charIndex);
    excerpt += eol === -1 ? xml.slice(charIndex) : xml.slice(charIndex, eol);
    let excerptStart = 0;
    if (excerpt.length > 50) {
      if (column < 40) {
        excerpt = excerpt.slice(0, 50);
      } else {
        excerptStart = column - 20;
        excerpt = excerpt.slice(excerptStart, column + 30);
      }
    }
    super(`${message} (line ${line}, column ${column})
  ${excerpt}
` + " ".repeat(column - excerptStart + 1) + "^\n");
    this.column = column;
    this.excerpt = excerpt;
    this.line = line;
    this.name = "XmlError";
    this.pos = charIndex;
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/XmlProcessingInstruction.js
var XmlProcessingInstruction = class extends XmlNode {
  constructor(name, content = "") {
    super();
    this.name = name;
    this.content = content;
  }
  get type() {
    return XmlNode.TYPE_PROCESSING_INSTRUCTION;
  }
  toJSON() {
    return Object.assign(XmlNode.prototype.toJSON.call(this), {
      name: this.name,
      content: this.content
    });
  }
};

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/lib/Parser.js
var emptyString2 = "";
var Parser = class {
  /**
   * @param xml XML string to parse.
   * @param options Parser options.
   */
  constructor(xml, options = {}) {
    let doc = this.document = new XmlDocument();
    this.currentNode = doc;
    this.options = options;
    this.scanner = new StringScanner(xml);
    if (this.options.includeOffsets) {
      doc.start = 0;
      doc.end = xml.length;
    }
    this.parse();
  }
  /**
   * Adds the given `XmlNode` as a child of `this.currentNode`.
   */
  addNode(node, charIndex) {
    node.parent = this.currentNode;
    if (this.options.includeOffsets) {
      node.start = this.scanner.charIndexToByteIndex(charIndex);
      node.end = this.scanner.charIndexToByteIndex();
    }
    this.currentNode.children.push(node);
    return true;
  }
  /**
   * Adds the given _text_ to the document, either by appending it to a
   * preceding `XmlText` node (if possible) or by creating a new `XmlText` node.
   *
   * When _normalize_ is `true` (the default), line breaks in _text_ are
   * normalized per section 2.11 of the XML spec. This must be `false` for text
   * that comes from a character or entity reference, since references aren't
   * subject to line break normalization.
   */
  addText(text2, charIndex, normalize = true) {
    let { children: children2 } = this.currentNode;
    let { length } = children2;
    if (normalize) {
      text2 = normalizeLineBreaks(text2);
    }
    if (length > 0) {
      let prevNode = children2[length - 1];
      if (prevNode?.type === XmlNode.TYPE_TEXT) {
        let textNode = prevNode;
        textNode.text += text2;
        if (this.options.includeOffsets) {
          textNode.end = this.scanner.charIndexToByteIndex();
        }
        return true;
      }
    }
    return this.addNode(new XmlText(text2), charIndex);
  }
  /**
   * Consumes element attributes.
   *
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#sec-starttags
   */
  consumeAttributes() {
    let attributes = /* @__PURE__ */ Object.create(null);
    while (this.consumeWhitespace()) {
      let attrName = this.consumeName();
      if (!attrName) {
        break;
      }
      let attrValue = this.consumeEqual() && this.consumeAttributeValue();
      if (attrValue === false) {
        throw this.error("Attribute value expected");
      }
      if (attrName in attributes) {
        throw this.error(`Duplicate attribute: ${attrName}`);
      }
      if (attrName === "xml:space" && attrValue !== "default" && attrValue !== "preserve") {
        throw this.error('Value of the `xml:space` attribute must be "default" or "preserve"');
      }
      attributes[attrName] = attrValue;
    }
    if (this.options.sortAttributes) {
      let attrNames = Object.keys(attributes).sort();
      let sortedAttributes = /* @__PURE__ */ Object.create(null);
      for (let i = 0; i < attrNames.length; ++i) {
        let attrName = attrNames[i];
        sortedAttributes[attrName] = attributes[attrName];
      }
      attributes = sortedAttributes;
    }
    return attributes;
  }
  /**
   * Consumes an `AttValue` (attribute value) if possible.
   *
   * @returns
   *   Contents of the `AttValue` minus quotes, or `false` if nothing was
   *   consumed. An empty string indicates that an `AttValue` was consumed but
   *   was empty.
   *
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-AttValue
   */
  consumeAttributeValue() {
    let { scanner } = this;
    let quote = scanner.peek();
    if (quote !== '"' && quote !== "'") {
      return false;
    }
    scanner.advance();
    let chars;
    let isClosed = false;
    let value = emptyString2;
    let regex = quote === '"' ? attValueCharDoubleQuote : attValueCharSingleQuote;
    matchLoop: while (!scanner.isEnd) {
      chars = scanner.consumeUntilMatch(regex);
      if (chars) {
        this.validateChars(chars);
        value += chars.replace(attValueNormalizedWhitespace, " ");
      }
      switch (scanner.peek()) {
        case quote:
          isClosed = true;
          break matchLoop;
        case "&":
          value += this.consumeReference();
          continue;
        case "<":
          throw this.error("Unescaped `<` is not allowed in an attribute value");
        default:
          break matchLoop;
      }
    }
    if (!isClosed) {
      throw this.error("Unclosed attribute");
    }
    scanner.advance();
    return value;
  }
  /**
   * Consumes a CDATA section if possible.
   *
   * @returns Whether a CDATA section was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#sec-cdata-sect
   */
  consumeCdataSection() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    if (!scanner.consumeString("<![CDATA[")) {
      return false;
    }
    let text2 = scanner.consumeUntilString("]]>");
    this.validateChars(text2);
    if (!scanner.consumeString("]]>")) {
      throw this.error("Unclosed CDATA section");
    }
    return this.options.preserveCdata ? this.addNode(new XmlCdata(normalizeLineBreaks(text2)), startIndex) : this.addText(text2, startIndex);
  }
  /**
   * Consumes character data if possible.
   *
   * @returns Whether character data was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#dt-chardata
   */
  consumeCharData() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    let charData = scanner.consumeUntilMatch(endCharData);
    if (!charData) {
      return false;
    }
    this.validateChars(charData);
    if (scanner.peek(3) === "]]>") {
      throw this.error("Element content may not contain the CDATA section close delimiter `]]>`");
    }
    return this.addText(charData, startIndex);
  }
  /**
   * Consumes a comment if possible.
   *
   * @returns Whether a comment was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-Comment
   */
  consumeComment() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    if (!scanner.consumeString("<!--")) {
      return false;
    }
    let content = scanner.consumeUntilString("--");
    this.validateChars(content);
    if (!scanner.consumeString("-->")) {
      if (scanner.peek(2) === "--") {
        throw this.error("The string `--` isn't allowed inside a comment");
      }
      throw this.error("Unclosed comment");
    }
    return this.options.preserveComments ? this.addNode(new XmlComment(normalizeLineBreaks(content)), startIndex) : true;
  }
  /**
   * Consumes a reference in a content context if possible.
   *
   * This differs from `consumeReference()` in that a consumed reference will be
   * added to the document as a text node instead of returned.
   *
   * @returns Whether a reference was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#entproc
   */
  consumeContentReference() {
    let startIndex = this.scanner.charIndex;
    let ref = this.consumeReference();
    return ref ? this.addText(ref, startIndex, false) : false;
  }
  /**
   * Consumes a doctype declaration if possible.
   *
   * This is a loose implementation since doctype declarations are currently
   * discarded without further parsing.
   *
   * @returns Whether a doctype declaration was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#dtd
   */
  consumeDoctypeDeclaration() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    if (!scanner.consumeString("<!DOCTYPE")) {
      return false;
    }
    let name = this.consumeWhitespace() && this.consumeName();
    if (!name) {
      throw this.error("Expected a name");
    }
    let publicId;
    let systemId;
    if (this.consumeWhitespace()) {
      if (scanner.consumeString("PUBLIC")) {
        publicId = this.consumeWhitespace() && this.consumePubidLiteral();
        if (publicId === false) {
          throw this.error("Expected a public identifier");
        }
        this.consumeWhitespace();
      }
      if (publicId !== void 0 || scanner.consumeString("SYSTEM")) {
        this.consumeWhitespace();
        systemId = this.consumeSystemLiteral();
        if (systemId === false) {
          throw this.error("Expected a system identifier");
        }
        this.consumeWhitespace();
      }
    }
    let internalSubset;
    if (scanner.consumeString("[")) {
      internalSubset = scanner.consumeUntilMatch(/\][\x20\t\r\n]*>/);
      if (!scanner.consumeString("]")) {
        throw this.error("Unclosed internal subset");
      }
      this.consumeWhitespace();
    }
    if (!scanner.consumeString(">")) {
      throw this.error("Unclosed doctype declaration");
    }
    return this.options.preserveDocumentType ? this.addNode(new XmlDocumentType(name, publicId, systemId, internalSubset), startIndex) : true;
  }
  /**
   * Consumes an element if possible.
   *
   * @returns Whether an element was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-element
   */
  consumeElement() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    if (!scanner.consumeString("<")) {
      return false;
    }
    let name = this.consumeName();
    if (!name) {
      scanner.reset(startIndex);
      return false;
    }
    let attributes = this.consumeAttributes();
    let isEmpty = !!scanner.consumeString("/>");
    let element = new XmlElement(name, attributes);
    element.parent = this.currentNode;
    if (!isEmpty) {
      if (!scanner.consumeString(">")) {
        throw this.error(`Unclosed start tag for element \`${name}\``);
      }
      this.currentNode = element;
      do {
        this.consumeCharData();
      } while (this.consumeElement() || this.consumeContentReference() || this.consumeCdataSection() || this.consumeProcessingInstruction() || this.consumeComment());
      let endTagMark = scanner.charIndex;
      let endTagName;
      if (!scanner.consumeString("</") || !(endTagName = this.consumeName()) || endTagName !== name) {
        scanner.reset(endTagMark);
        throw this.error(`Missing end tag for element ${name}`);
      }
      this.consumeWhitespace();
      if (!scanner.consumeString(">")) {
        throw this.error(`Unclosed end tag for element ${name}`);
      }
      this.currentNode = element.parent;
    }
    return this.addNode(element, startIndex);
  }
  /**
   * Consumes an `Eq` production if possible.
   *
   * @returns Whether an `Eq` production was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-Eq
   */
  consumeEqual() {
    this.consumeWhitespace();
    if (this.scanner.consumeString("=")) {
      this.consumeWhitespace();
      return true;
    }
    return false;
  }
  /**
   * Consumes `Misc` content if possible.
   *
   * @returns Whether anything was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-Misc
   */
  consumeMisc() {
    return this.consumeComment() || this.consumeProcessingInstruction() || this.consumeWhitespace();
  }
  /**
   * Consumes one or more `Name` characters if possible.
   *
   * @returns `Name` characters, or an empty string if none were consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-Name
   */
  consumeName() {
    return isNameStartChar(this.scanner.peek()) ? this.scanner.consumeMatchFn(isNameChar) : emptyString2;
  }
  /**
   * Consumes a processing instruction if possible.
   *
   * @returns Whether a processing instruction was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#sec-pi
   */
  consumeProcessingInstruction() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    if (!scanner.consumeString("<?")) {
      return false;
    }
    let name = this.consumeName();
    if (name) {
      if (name.toLowerCase() === "xml") {
        scanner.reset(startIndex);
        throw this.error("XML declaration isn't allowed here");
      }
    } else {
      throw this.error("Invalid processing instruction");
    }
    if (!this.consumeWhitespace()) {
      if (scanner.consumeString("?>")) {
        return this.addNode(new XmlProcessingInstruction(name), startIndex);
      }
      throw this.error("Whitespace is required after a processing instruction name");
    }
    let content = scanner.consumeUntilString("?>");
    this.validateChars(content);
    if (!scanner.consumeString("?>")) {
      throw this.error("Unterminated processing instruction");
    }
    return this.addNode(new XmlProcessingInstruction(name, normalizeLineBreaks(content)), startIndex);
  }
  /**
   * Consumes a prolog if possible.
   *
   * @returns Whether a prolog was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#sec-prolog-dtd
   */
  consumeProlog() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    this.consumeXmlDeclaration();
    while (this.consumeMisc()) {
    }
    if (this.consumeDoctypeDeclaration()) {
      while (this.consumeMisc()) {
      }
    }
    return startIndex < scanner.charIndex;
  }
  /**
   * Consumes a public identifier literal if possible.
   *
   * @returns
   *   Value of the public identifier literal minus quotes, or `false` if
   *   nothing was consumed. An empty string indicates that a public id literal
   *   was consumed but was empty.
   *
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-PubidLiteral
   */
  consumePubidLiteral() {
    let startIndex = this.scanner.charIndex;
    let value = this.consumeSystemLiteral();
    if (value !== false && !/^[-\x20\r\na-zA-Z0-9'()+,./:=?;!*#@$_%]*$/.test(value)) {
      this.scanner.reset(startIndex);
      throw this.error("Invalid character in public identifier");
    }
    return value;
  }
  /**
   * Consumes a reference if possible.
   *
   * This differs from `consumeContentReference()` in that a consumed reference
   * will be returned rather than added to the document.
   *
   * @returns
   *   Parsed reference value, or `false` if nothing was consumed (to
   *   distinguish from a reference that resolves to an empty string).
   *
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-Reference
   */
  consumeReference() {
    let { scanner } = this;
    if (!scanner.consumeString("&")) {
      return false;
    }
    let ref = scanner.consumeMatchFn(isReferenceChar);
    if (scanner.consume() !== ";") {
      throw this.error("Unterminated reference (a reference must end with `;`)");
    }
    let parsedValue;
    if (ref[0] === "#") {
      let codePoint = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (isNaN(codePoint) || !/^#(?:x[0-9A-Fa-f]+|[0-9]+)$/.test(ref)) {
        throw this.error("Invalid character reference");
      }
      if (!isXmlCodePoint(codePoint)) {
        throw this.error("Character reference resolves to an invalid character");
      }
      parsedValue = String.fromCodePoint(codePoint);
    } else {
      parsedValue = predefinedEntities[ref];
      if (parsedValue === void 0) {
        let { ignoreUndefinedEntities, resolveUndefinedEntity } = this.options;
        let wrappedRef = `&${ref};`;
        if (resolveUndefinedEntity) {
          let resolvedValue = resolveUndefinedEntity(wrappedRef);
          if (resolvedValue !== null && resolvedValue !== void 0) {
            let type = typeof resolvedValue;
            if (type !== "string") {
              throw new TypeError(`\`resolveUndefinedEntity()\` must return a string, \`null\`, or \`undefined\`, but returned a value of type ${type}`);
            }
            return resolvedValue;
          }
        }
        if (ignoreUndefinedEntities) {
          return wrappedRef;
        }
        scanner.reset(-wrappedRef.length);
        throw this.error(`Named entity isn't defined: ${wrappedRef}`);
      }
    }
    return parsedValue;
  }
  /**
   * Consumes a `SystemLiteral` if possible.
   *
   * A `SystemLiteral` is similar to an attribute value, but allows the
   * characters `<` and `&` and doesn't replace references.
   *
   * @returns
   *   Value of the `SystemLiteral` minus quotes, or `false` if nothing was
   *   consumed. An empty string indicates that a `SystemLiteral` was consumed
   *   but was empty.
   *
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-SystemLiteral
   */
  consumeSystemLiteral() {
    let { scanner } = this;
    let quote = scanner.consumeString('"') || scanner.consumeString("'");
    if (!quote) {
      return false;
    }
    let value = scanner.consumeUntilString(quote);
    this.validateChars(value);
    if (!scanner.consumeString(quote)) {
      throw this.error("Missing end quote");
    }
    return value;
  }
  /**
   * Consumes one or more whitespace characters if possible.
   *
   * @returns Whether any whitespace characters were consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#white
   */
  consumeWhitespace() {
    return !!this.scanner.consumeMatchFn(isWhitespace);
  }
  /**
   * Consumes an XML declaration if possible.
   *
   * @returns Whether an XML declaration was consumed.
   * @see https://www.w3.org/TR/2008/REC-xml-20081126/#NT-XMLDecl
   */
  consumeXmlDeclaration() {
    let { scanner } = this;
    let startIndex = scanner.charIndex;
    if (!scanner.consumeString("<?xml")) {
      return false;
    }
    if (isNameChar(scanner.peek())) {
      scanner.reset(startIndex);
      return false;
    }
    if (!this.consumeWhitespace()) {
      throw this.error("Invalid XML declaration");
    }
    let version = !!scanner.consumeString("version") && this.consumeEqual() && this.consumeSystemLiteral();
    if (version === false) {
      throw this.error("XML version is missing or invalid");
    } else if (!/^1\.[0-9]+$/.test(version)) {
      throw this.error("Invalid character in version number");
    }
    let encoding;
    let standalone;
    if (this.consumeWhitespace()) {
      encoding = !!scanner.consumeString("encoding") && this.consumeEqual() && this.consumeSystemLiteral();
      if (encoding) {
        if (!/^[A-Za-z][\w.-]*$/.test(encoding)) {
          throw this.error("Invalid character in encoding name");
        }
        this.consumeWhitespace();
      }
      standalone = !!scanner.consumeString("standalone") && this.consumeEqual() && this.consumeSystemLiteral();
      if (standalone) {
        if (standalone !== "yes" && standalone !== "no") {
          throw this.error('Only "yes" and "no" are permitted as values of `standalone`');
        }
        this.consumeWhitespace();
      }
    }
    if (!scanner.consumeString("?>")) {
      throw this.error("Invalid or unclosed XML declaration");
    }
    return this.options.preserveXmlDeclaration ? this.addNode(new XmlDeclaration(version, encoding || void 0, standalone || void 0), startIndex) : true;
  }
  /**
   * Returns an `XmlError` for the current scanner position.
   */
  error(message) {
    let { scanner } = this;
    return new XmlError(message, scanner.charIndex, scanner.string);
  }
  /**
   * Parses the XML input.
   */
  parse() {
    this.scanner.consumeString("\uFEFF");
    this.consumeProlog();
    if (!this.consumeElement()) {
      throw this.error("Root element is missing or invalid");
    }
    while (this.consumeMisc()) {
    }
    if (!this.scanner.isEnd) {
      throw this.error("Extra content at the end of the document");
    }
  }
  /**
   * Throws an invalid character error if any character in the given _string_
   * isn't a valid XML character.
   */
  validateChars(string) {
    let { length } = string;
    for (let i = 0; i < length; ++i) {
      let cp = string.codePointAt(i);
      if (!isXmlCodePoint(cp)) {
        this.scanner.reset(-([...string].length - i));
        throw this.error("Invalid character");
      }
      if (cp > 65535) {
        i += 1;
      }
    }
  }
};
function normalizeLineBreaks(text2) {
  let i = 0;
  while ((i = text2.indexOf("\r", i)) !== -1) {
    text2 = text2[i + 1] === "\n" ? text2.slice(0, i) + text2.slice(i + 1) : text2.slice(0, i) + "\n" + text2.slice(i + 1);
  }
  return text2;
}

// ../../cloudflare/node_modules/@rgrove/parse-xml/dist/index.js
function parseXml(xml, options) {
  return new Parser(xml, options).document;
}

// ../../cloudflare/src/papers/identifiers.ts
var ARXIV_ID = /(?:arXiv\s*:\s*|arxiv\s*\.\s*org\s*\/\s*abs\s*\/\s*)((?:\d{4}\s*\.\s*\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\s*\/\s*\d{7})(?:v\d+)?)/i;
function extractArxivId(text2) {
  const match = ARXIV_ID.exec(text2);
  return match ? match[1].replace(/\s+/g, "") : null;
}

// ../../cloudflare/src/papers/tei.ts
var isElement = (node) => node instanceof XmlElement;
function* descendants(node, name) {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (!name || child.name === name) yield child;
    yield* descendants(child, name);
  }
}
function children(node, name) {
  return node ? node.children.filter((c) => isElement(c) && c.name === name) : [];
}
function find(node, path) {
  let current = node;
  for (const step of path) {
    current = children(current, step.name).find((c) => !step.attr || c.attributes[step.attr[0]] === step.attr[1]) ?? null;
    if (!current) return null;
  }
  return current;
}
function text(node) {
  if (!node) return null;
  const words = node.text.split(/\s+/).filter(Boolean).join(" ");
  return words || null;
}
function ownText(node) {
  if (!node) return null;
  const own = node.children.filter((c) => c instanceof XmlText).map((c) => c.text).join("");
  const words = own.split(/\s+/).filter(Boolean).join(" ");
  return words || null;
}
function parse(xml) {
  const root = parseXml(xml).root;
  if (!root) throw new Error("GROBID returned no document");
  return root;
}
var SMALL_WORDS = /* @__PURE__ */ new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "per", "the", "to", "via", "with", "without", "yet"]);
function normalizeTitle(title) {
  if (!title) return title;
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return title;
  const parts = title.match(/[A-Za-z]+|[^A-Za-z]+/g) ?? [];
  const wordIndexes = parts.map((p, i) => /^[A-Za-z]+$/.test(p) ? i : -1).filter((i) => i >= 0);
  const first = wordIndexes[0], last = wordIndexes[wordIndexes.length - 1];
  let afterColon = false;
  parts.forEach((part, index) => {
    if (!/^[A-Za-z]+$/.test(part)) {
      if (part.includes(":")) afterColon = true;
      return;
    }
    const lower = part.toLowerCase();
    if (SMALL_WORDS.has(lower) && index !== first && index !== last && !afterColon) parts[index] = lower;
    else if (part.length <= 4 && !SMALL_WORDS.has(lower)) parts[index] = part;
    else if (index === first && part.startsWith("X") && part.length > 5) parts[index] = "X" + lower[1].toUpperCase() + lower.slice(2);
    else parts[index] = lower[0].toUpperCase() + lower.slice(1);
    afterColon = false;
  });
  return parts.join("");
}
function personName(person) {
  const parts = [...descendants(person)].filter((p) => p.name === "forename" || p.name === "surname").map(text).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
function parseHeader(xml) {
  const root = parse(xml);
  const bibl = [...descendants(root, "sourceDesc")].map((s) => children(s, "biblStruct")[0]).find(Boolean) ?? null;
  if (!bibl) throw new Error("GROBID returned no bibliographic header");
  const title = normalizeTitle(text(find(bibl, [{ name: "analytic" }, { name: "title", attr: ["type", "main"] }])));
  const authors = children(find(bibl, [{ name: "analytic" }]), "author").map((a) => {
    const person = children(a, "persName")[0];
    return person ? [...person.children].filter((p) => isElement(p) && (p.name === "forename" || p.name === "surname")).map(text).filter(Boolean).join(" ") : "";
  }).filter(Boolean);
  const journal = text(find(bibl, [{ name: "monogr" }, { name: "title", attr: ["level", "j"] }]));
  const when = find(bibl, [{ name: "monogr" }, { name: "imprint" }, { name: "date" }])?.attributes.when;
  const year = when && /^\d{4}/.test(when) ? Number(when.slice(0, 4)) : null;
  const { doi, arxiv } = identifiers(bibl);
  return { title, authors, journal, year, doi, arxiv_id: arxiv };
}
function identifiers(bibl) {
  let doi = null, arxiv = null;
  for (const idno of descendants(bibl, "idno")) {
    const kind = (idno.attributes.type ?? "").toLowerCase(), value = text(idno);
    if (!value) continue;
    if (kind === "doi" && !doi) doi = value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    else if (kind === "arxiv" && !arxiv) arxiv = value.replace(/^arxiv:\s*/i, "").trim();
  }
  return { doi, arxiv };
}
var MARKER_NUMBER = /[[(]\s*(\d{1,3})/;
var EQUATION_NUMBER = /^\(\s*\d{1,3}\s*\)$/;
var CROSS_REFERENCE_KIND = /\b(box|fig(?:ure)?|table)\s*$/i;
var TARGET_HEADING = /^\s*(box|fig(?:ure)?|table)\s*([\w.-]+)/i;
var FIGURE_PREFIX_EMS = 3;
var EARLIEST_YEAR = 1500;
var LATEST_YEAR = 2100;
function boxes(coords, pages) {
  const out = [];
  for (const box of (coords ?? "").split(";")) {
    const parts = box.split(",");
    if (parts.length !== 5) continue;
    const [page, x, y, w, h] = parts.map(Number);
    if (!Number.isInteger(page) || [x, y, w, h].some(Number.isNaN)) continue;
    const [width, height] = pages.get(page) ?? [0, 0];
    if (!width || !height) continue;
    out.push({ page, x: x / width, y: y / height, w: w / width, h: h / height });
  }
  return out;
}
function yearIn(...sources) {
  for (const source of sources) {
    for (const match of (source ?? "").matchAll(/\d{4}/g)) {
      const year = Number(match[0]);
      if (year >= EARLIEST_YEAR && year <= LATEST_YEAR) return year;
    }
  }
  return null;
}
function referenceFrom(bibl, key, index, pages) {
  const raw = text(children(bibl, "note").find((n) => n.attributes.type === "raw_reference") ?? null);
  let title = text(find(bibl, [{ name: "analytic" }, { name: "title", attr: ["level", "a"] }]));
  let proceedings = text(find(bibl, [{ name: "monogr" }, { name: "title", attr: ["level", "m"] }]));
  if (!title) {
    title = proceedings;
    proceedings = null;
  }
  const journal = text(find(bibl, [{ name: "monogr" }, { name: "title", attr: ["level", "j"] }])) || proceedings || ownText(find(bibl, [{ name: "monogr" }, { name: "meeting" }]));
  const authors = [...descendants(bibl, "persName")].map(personName).filter((n) => Boolean(n));
  const date = find(bibl, [{ name: "monogr" }, { name: "imprint" }, { name: "date" }]) ?? [...descendants(bibl, "date")][0] ?? null;
  const year = date ? yearIn(date.attributes.when, text(date)) : null;
  const ids = identifiers(bibl);
  const doi = ids.doi, arxiv = ids.arxiv ?? extractArxivId(raw ?? "");
  const first = boxes(bibl.attributes.coords, pages)[0];
  return { key, index, raw, title, authors, year, journal, doi, arxiv_id: arxiv, page: first?.page ?? null, y: first?.y ?? null };
}
function numberedTarget(label, references) {
  const match = label.match(MARKER_NUMBER);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= references.length ? references[n - 1].key : null;
}
function linkKind(value) {
  const lower = value.toLowerCase();
  return lower.startsWith("fig") ? "figure" : lower;
}
function precedingText(root) {
  const prefixes = /* @__PURE__ */ new Map();
  let preceding = "";
  const visit = (element) => {
    for (const child of element.children) {
      if (child instanceof XmlText) preceding = (preceding + child.text).slice(-40);
      else if (isElement(child)) {
        prefixes.set(child, preceding);
        visit(child);
      }
    }
  };
  visit(root);
  return prefixes;
}
function parseTei(xml) {
  const root = parse(xml);
  const pages = /* @__PURE__ */ new Map();
  for (const surface of descendants(root, "surface")) {
    const n = Number(surface.attributes.n), lrx = Number(surface.attributes.lrx), lry = Number(surface.attributes.lry);
    if (Number.isInteger(n) && !Number.isNaN(lrx) && !Number.isNaN(lry)) pages.set(n, [lrx, lry]);
  }
  const references = [];
  const byKey = /* @__PURE__ */ new Set();
  for (const bibl of descendants(root, "biblStruct")) {
    const key = bibl.attributes["xml:id"];
    if (!key) continue;
    references.push(referenceFrom(bibl, key, references.length, pages));
    byKey.add(key);
  }
  const markers = [...descendants(root, "ref")].filter((r) => r.attributes.type === "bibr");
  const labels = markers.map((m) => text(m) ?? "");
  const equations = labels.filter((l) => EQUATION_NUMBER.test(l)).length;
  const bracketed = labels.filter((l) => l.includes("[") || l.includes("]")).length;
  const citesInBrackets = bracketed > equations;
  const citations = [];
  markers.forEach((marker, i) => {
    const label = labels[i];
    if (citesInBrackets && EQUATION_NUMBER.test(label)) return;
    let target = (marker.attributes.target ?? "").replace(/^#/, "");
    let inferred = false;
    if (!byKey.has(target)) {
      target = numberedTarget(label, references);
      inferred = target !== null;
    }
    if (!target) return;
    for (const box of boxes(marker.attributes.coords, pages)) citations.push({ key: target, label, inferred, ...box });
  });
  const figures = /* @__PURE__ */ new Map();
  const namedTargets = /* @__PURE__ */ new Map();
  for (const figure of descendants(root, "figure")) {
    const key = figure.attributes["xml:id"];
    const found = boxes(figure.attributes.coords, pages);
    if (!key || !found.length) continue;
    figures.set(key, found[0]);
    const heading = [children(figure, "head")[0], children(figure, "label")[0]].map(text).filter(Boolean).join(" ");
    const match = heading.match(TARGET_HEADING);
    if (match) namedTargets.set(`${linkKind(match[1])}
${match[2].toLowerCase()}`, found[0]);
  }
  const prefixes = precedingText(root);
  const links = [];
  for (const marker of descendants(root, "ref")) {
    if (marker.attributes.type !== "figure") continue;
    const label = text(marker) ?? "";
    const kindMatch = (prefixes.get(marker) ?? "").match(CROSS_REFERENCE_KIND);
    const kind = kindMatch ? linkKind(kindMatch[1]) : "figure";
    const target = namedTargets.get(`${kind}
${label.toLowerCase()}`) ?? figures.get((marker.attributes.target ?? "").replace(/^#/, ""));
    if (!target) continue;
    for (const box of boxes(marker.attributes.coords, pages)) {
      const [pageWidth, pageHeight] = pages.get(box.page);
      const prefix = Math.min(box.x, box.h * pageHeight / pageWidth * FIGURE_PREFIX_EMS);
      links.push({ kind, label, ...box, x: box.x - prefix, w: box.w + prefix, target_page: target.page, target_y: target.y });
    }
  }
  return { references, citations, links };
}

// src/grobid.ts
var TIMEOUT_MS = 3e5;
var GrobidError = class extends Error {
};
async function post(base, path, pdf, fields) {
  const form = new FormData();
  form.set("input", new Blob([pdf], { type: "application/pdf" }), "paper.pdf");
  for (const [name, value] of fields) form.append(name, value);
  let response;
  try {
    response = await fetch(`${base.replace(/\/+$/, "")}${path}`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new GrobidError(`GROBID unreachable: ${error.message}`);
  }
  if (response.status === 204) throw new GrobidError("GROBID could not read this PDF (no text extracted)");
  if (response.status !== 200) throw new GrobidError(`GROBID returned ${response.status}`);
  return response.text();
}
function grobidAt(base) {
  return {
    fulltext: (pdf) => post(base, "/api/processFulltextDocument", pdf, [
      // Repeated once per element boxes are wanted for; without it GROBID
      // returns the structure but not the geometry.
      ["teiCoordinates", "ref"],
      ["teiCoordinates", "biblStruct"],
      ["teiCoordinates", "figure"],
      ["includeRawCitations", "1"],
      // Consolidating the citations would have GROBID call CrossRef once
      // per reference inside this request. Papol looks up later and lazily.
      ["consolidateCitations", "0"],
      ["consolidateHeader", "0"]
    ]),
    // Consolidated: GROBID asks CrossRef for the paper itself, which is
    // how a paper that prints no identifier gets its DOI.
    header: (pdf) => post(base, "/api/processHeaderDocument", pdf, [["consolidateHeader", "1"]])
  };
}

// src/service.ts
var Refusal = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function isPdf(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}
async function through(bytes, call, read) {
  if (!isPdf(bytes)) throw new Refusal(400, "The body is not a PDF");
  let tei;
  try {
    tei = await call(bytes);
  } catch (error) {
    if (error instanceof GrobidError) throw new Refusal(502, error.message);
    throw error;
  }
  try {
    return read(tei);
  } catch (error) {
    throw new Refusal(502, `GROBID's answer could not be read: ${error.message}`);
  }
}
function analyze(grobid, bytes) {
  return through(bytes, grobid.fulltext, parseTei);
}
function header(grobid, bytes) {
  return through(bytes, grobid.header, parseHeader);
}

// src/files.ts
var DEFAULT_FILE_ORIGINS = ["https://files.papol.io", "https://files-dev.papol.io"];
var PAPER_PATH = /^\/uploads\/([0-9a-f]{64})\.pdf$/;
var TIMEOUT_MS2 = 12e4;
function fileOriginsFrom(value) {
  const listed = (value ?? "").split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean);
  return listed.length ? listed : DEFAULT_FILE_ORIGINS;
}
function paperAddress(value, origins) {
  if (typeof value !== "string") throw new Refusal(400, "Send { url } naming a paper's address");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Refusal(400, "The url is not an address");
  }
  if (!origins.includes(url.origin)) throw new Refusal(400, `The helper does not fetch from ${url.origin}`);
  const named = PAPER_PATH.exec(url.pathname);
  if (!named || url.search || url.hash) throw new Refusal(400, "The url is not a paper's address");
  return { url, sha256: named[1] };
}
async function fetchPaper(address, maxBytes, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(address.url, { headers: { "user-agent": "papol-helper" }, signal: AbortSignal.timeout(TIMEOUT_MS2) });
  } catch (error) {
    throw new Refusal(502, `The bucket could not be reached: ${error.message}`);
  }
  if (response.status === 404) throw new Refusal(404, "The bucket has no file at that address");
  if (response.status !== 200 || !response.body) throw new Refusal(502, `The bucket answered ${response.status}`);
  const chunks = [];
  let size = 0;
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Refusal(413, `The file is over ${maxBytes} bytes`);
    }
    hash.update(value);
    chunks.push(value);
  }
  if (hash.digest("hex") !== address.sha256) throw new Refusal(422, "The file does not hash to its name");
  return new Uint8Array(Buffer.concat(chunks));
}

// src/server.ts
var MAX_BODY = 100 * 1024 * 1024;
var MAX_ADDRESS = 4 * 1024;
var DEFAULT_PORT = 8072;
var GROBID = "http://127.0.0.1:8070";
function readBody(request, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        request.destroy();
        reject(new Refusal(413, `The body is over ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", reject);
  });
}
async function paperOf(request, options) {
  const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return readBody(request);
  let sent;
  try {
    sent = JSON.parse(new TextDecoder().decode(await readBody(request, MAX_ADDRESS)));
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(400, "The body is not JSON");
  }
  return fetchPaper(paperAddress(sent?.url, options.fileOrigins), MAX_BODY, options.fetch);
}
async function answer(grobid, request, options) {
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/health") return [200, { ok: true }];
  if (path !== "/analyze" && path !== "/header") throw new Refusal(404, "No such endpoint");
  if (request.method !== "POST") throw new Refusal(405, "POST a PDF here");
  const bytes = await paperOf(request, options);
  return [200, path === "/analyze" ? await analyze(grobid, bytes) : await header(grobid, bytes)];
}
function createServer(grobid, log = console.log, options = {}) {
  const settled = {
    fileOrigins: options.fileOrigins ?? fileOriginsFrom(void 0),
    fetch: options.fetch ?? fetch
  };
  return http.createServer(async (request, response) => {
    const started = Date.now();
    let status, body, detail = "";
    try {
      [status, body] = await answer(grobid, request, settled);
    } catch (error) {
      status = error instanceof Refusal ? error.status : 500;
      detail = error instanceof Refusal ? error.message : `Unexpected: ${error.message}`;
      body = { detail };
    }
    const json = JSON.stringify(body);
    log(`${(/* @__PURE__ */ new Date()).toISOString()} ${request.method} ${request.url} ${status} ${request.headers["content-length"] ?? "-"}B ${Date.now() - started}ms${detail ? ` ${detail}` : ""}`);
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
    response.end(json);
  });
}
var runAsProgram = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (runAsProgram) {
  const port = Number(process.env.PAPOL_HELPER_PORT || DEFAULT_PORT);
  const server = createServer(grobidAt(process.env.PAPOL_GROBID_URL || GROBID), console.log, {
    fileOrigins: fileOriginsFrom(process.env.PAPOL_HELPER_FILE_ORIGINS)
  });
  server.requestTimeout = 3e5;
  server.listen(port, "127.0.0.1", () => console.log(`papol-helper listening on 127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
export {
  MAX_BODY,
  createServer,
  fileOriginsFrom,
  grobidAt
};
