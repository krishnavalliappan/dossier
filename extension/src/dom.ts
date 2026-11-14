// A small typed helper for building the popup's and options page's DOM.

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

/** An element with attributes (`on*` are listeners, `true`/`false` toggle boolean attributes) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(value));
  }
  el.append(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
  return el;
}

/** Lucide's "settings" icon, as Dossier's own screens use. */
export function gear(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
  svg.innerHTML =
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>';
  return svg;
}

/** The Dossier mark (the app's icon). */
export function mark(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mark");
  svg.innerHTML =
    '<rect width="64" height="64" rx="14.08" fill="var(--color-primary)"/><path fill="var(--color-on-primary)" transform="matrix(0.02844 0 0 -0.02844 10.214 51.200)" d="M1179.8 691.9Q1179.8 974 1032.5 1107.7Q885.3 1241.3 625.7 1241.3H354.9L338.3 1350H674.8Q936.6 1350 1111 1279.8Q1285.4 1209.6 1372.4 1068.2Q1459.5 926.8 1459.5 714.2Q1459.5 486.8 1357.2 327.4Q1254.8 168 1077.9 84Q900.9 0 678.3 0H338.3L354.9 108.7H646.1Q807.3 108.7 927.1 168.3Q1047 227.8 1113.4 356.5Q1179.8 485.1 1179.8 691.9ZM72.3 0V41L223.4 95.9V1254.2L72.3 1308.9V1350H489.4V0Z"/>';
  return svg;
}
