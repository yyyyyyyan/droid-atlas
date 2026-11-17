/*
 * Evaluated in the page (agent-browser eval --stdin): measures what is
 * actually rendered rather than what the stylesheet intends.
 *
 * - Contrast: for every element that draws text or an icon, the WCAG contrast
 *   ratio of its color against the surface really behind it (backgrounds are
 *   composited up the ancestor chain, opacity included). Text needs 4.5:1,
 *   icons and other non-text marks 3:1.
 * - Targets: the hit box of every interactive element, including the
 *   invisible extension a ::before or ::after gives it. Anything under 44 px
 *   in either direction is listed; links inside running text are listed
 *   separately because a sentence cannot be 44 px tall.
 *
 * Elements that are not rendered, are clipped to nothing (the screen-reader
 * helpers) or are fully transparent are skipped. The result is a JSON string.
 */
(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const parsed = new Map();

  /** Any CSS color as [r, g, b, a] in sRGB, via the browser's own conversion. */
  const rgba = (css) => {
    const cached = parsed.get(css);
    if (cached) return cached;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    const value = [r, g, b, a / 255];
    parsed.set(css, value);
    return value;
  };

  const over = (top, bottom) => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha);
  };

  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const rendered = (element) => {
    if (!element.isConnected) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (style.clipPath.startsWith("inset(50%")) return false;
      if (node.tagName === "DIALOG" && !node.open) return false;
    }
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  /** The color behind an element: every ancestor's background composited from the page up. */
  const backdrop = (element) => {
    const layers = [];
    let image = false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") image = true;
      layers.push({ color: rgba(style.backgroundColor), opacity: Number(style.opacity) });
      if (node.tagName === "DIALOG") break;
    }
    const root = rgba(getComputedStyle(document.body).backgroundColor);
    let result = root[3] === 0 ? [255, 255, 255, 1] : [root[0], root[1], root[2], 1];
    for (const layer of layers.reverse()) {
      const color = [layer.color[0], layer.color[1], layer.color[2], layer.color[3] * layer.opacity];
      result = over(color, result);
    }
    return { color: result, image };
  };

  const opacityOf = (element) => {
    let opacity = 1;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  };

  const describe = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 3; node = node.parentElement) {
      const cls = typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      parts.unshift(node.tagName.toLowerCase() + cls);
    }
    return parts.join(" > ");
  };

  const hex = (color) => `#${color.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

  const pairs = new Map();
  const note = (kind, element, foreground, text) => {
    /* A mark is drawn with its own background, so what lies behind it starts at its parent. */
    const { color: behind, image } = backdrop(kind === "mark" ? element.parentElement : element);
    const fg = rgba(foreground);
    const drawn = over([fg[0], fg[1], fg[2], fg[3] * opacityOf(element)], behind);
    const value = ratio(drawn, behind);
    const key = `${kind}|${hex(drawn)}|${hex(behind)}`;
    const known = pairs.get(key);
    if (known) {
      known.count += 1;
      return;
    }
    pairs.set(key, {
      kind,
      fg: hex(drawn),
      bg: hex(behind),
      ratio: Math.round(value * 100) / 100,
      overImage: image,
      count: 1,
      where: describe(element),
      sample: text.trim().replace(/\s+/g, " ").slice(0, 40),
      disabled: Boolean(element.closest(":disabled, [aria-disabled='true']")),
    });
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || !node.nodeValue.trim() || seen.has(element)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(element.tagName)) continue;
    seen.add(element);
    if (!rendered(element)) continue;
    note("text", element, getComputedStyle(element).color, node.nodeValue);
  }
  for (const icon of document.querySelectorAll("svg.icon")) {
    if (rendered(icon)) note("icon", icon, getComputedStyle(icon).color, icon.closest("[aria-label]")?.getAttribute("aria-label") ?? "icon");
  }
  for (const mark of document.querySelectorAll(".dot, .sheet-grab-bar")) {
    if (rendered(mark)) note("mark", mark, getComputedStyle(mark).backgroundColor, mark.className);
  }
  for (const field of document.querySelectorAll("input[placeholder]")) {
    if (rendered(field) && !field.value) note("text", field, getComputedStyle(field, "::placeholder").color, field.placeholder);
  }

  const all = [...pairs.values()].sort((a, b) => a.ratio - b.ratio);
  const failing = all.filter((pair) => !pair.disabled && pair.ratio < (pair.kind === "text" ? 4.5 : 3));

  const pseudoBox = (element, which, box) => {
    const style = getComputedStyle(element, which);
    if (style.content === "none" || style.position !== "absolute") return null;
    const edge = (name) => (style[name] === "auto" ? 0 : parseFloat(style[name]));
    return { top: box.top + edge("top"), bottom: box.bottom - edge("bottom"), left: box.left + edge("left"), right: box.right - edge("right") };
  };
  const small = [];
  const inline = [];
  for (const element of document.querySelectorAll("a[href], button, select, input:not([type=hidden]), summary, [tabindex='0']")) {
    if (!rendered(element) || element.closest(":disabled")) continue;
    let target = element;
    if (element.tagName === "INPUT" && (element.type === "radio" || element.type === "checkbox")) target = element.closest("label") ?? element;
    const box = target.getBoundingClientRect();
    let { top, bottom, left, right } = box;
    /* An absolutely positioned pseudo-element is laid out against the nearest positioned ancestor, which is the element itself only when it is positioned. */
    const anchor = getComputedStyle(target).position === "static" && target.offsetParent ? target.offsetParent.getBoundingClientRect() : box;
    for (const which of ["::before", "::after"]) {
      const extra = pseudoBox(target, which, anchor);
      if (!extra) continue;
      top = Math.min(top, extra.top);
      bottom = Math.max(bottom, extra.bottom);
      left = Math.min(left, extra.left);
      right = Math.max(right, extra.right);
    }
    const width = Math.round(right - left);
    const height = Math.round(bottom - top);
    if (width >= 44 && height >= 44) continue;
    const record = { where: describe(element), label: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40), width, height };
    const inText = element.tagName === "A" && getComputedStyle(element).display.startsWith("inline") && element.parentElement
      && [...element.parentElement.childNodes].some((sibling) => sibling.nodeType === 3 && sibling.nodeValue.trim());
    (inText ? inline : small).push(record);
  }
  const dedupe = (list) => [...new Map(list.map((item) => [`${item.where}|${item.width}x${item.height}`, item])).values()];

  return JSON.stringify({
    route: location.hash,
    theme: document.documentElement.dataset.theme,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pairs: all.length,
    lowestText: all.find((pair) => pair.kind === "text" && !pair.disabled) ?? null,
    lowestNonText: all.find((pair) => pair.kind !== "text" && !pair.disabled) ?? null,
    failing,
    smallTargets: dedupe(small),
    inlineLinks: dedupe(inline).length,
  });
})();
