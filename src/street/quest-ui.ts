/**
 * The quest sheet: pick a theme, Muse Spark Open picks the stops (or the app
 * does, and says why), then start it on the street.
 */
import { h } from "../ui/dom.js";
import type { ShopAhead } from "./ahead.js";
import { localQuest, QUEST_THEMES, questPlaces, type Quest, type QuestPlace, type QuestTheme } from "./quest.js";
import { CATEGORY_STYLE, distanceText } from "./signs.js";

export type QuestOutcome = { quest: Quest; note: string };

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** The phone's clock as "Sa 14:05", so the model can prefer places that are open. */
export function localTimeText(d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getDay()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Muse Spark Open through /api/quest; the app's own pick when the server cannot answer. Null when the street has too few fitting places. */
export async function requestQuest(places: QuestPlace[], theme: QuestTheme, fetchImpl: typeof fetch = fetch): Promise<QuestOutcome | null> {
  let reason: string;
  try {
    const res = await fetchImpl("/api/quest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, places, localTime: localTimeText() }),
    });
    const body = (await res.json().catch(() => ({}))) as { quest?: Quest; latencyMs?: number; error?: string };
    if (res.ok && body.quest) {
      const seconds = Math.round((body.latencyMs ?? 0) / 100) / 10;
      return { quest: body.quest, note: `Stops picked by Muse Spark Open in ${seconds} s. It was told the kinds of places, not their names.` };
    }
    reason = body.error ?? `the quest service answered ${res.status}`;
  } catch (error) {
    reason = `the quest service is unreachable (${error instanceof Error ? error.message : String(error)})`;
  }
  const local = localQuest(places, theme);
  return local ? { quest: local, note: `Stops picked by the app: ${reason}.` } : null;
}

export class QuestSheet {
  readonly element: HTMLElement;
  private readonly shops: ShopAhead[];
  private readonly onStart: (quest: Quest, stops: ShopAhead[]) => void;

  constructor(shops: ShopAhead[], onStart: (quest: Quest, stops: ShopAhead[]) => void) {
    this.shops = shops;
    this.onStart = onStart;
    this.element = h("div", { class: "street-sheet hidden" });
  }

  open(): void {
    this.showThemes();
    this.element.classList.remove("hidden");
  }

  close(): void {
    this.element.classList.add("hidden");
  }

  private showThemes(): void {
    this.element.replaceChildren(
      h("h3", { text: "Make a quest" }),
      h("p", {
        class: "muted small",
        text: "Muse Spark Open picks two to four stops along this street for a theme. It is told the kinds of places and their hours, never their names: names, sides and distances come from the map.",
      }),
      h(
        "div",
        { class: "quest-themes" },
        ...(Object.keys(QUEST_THEMES) as QuestTheme[]).map((theme) => h("button", { onclick: () => void this.make(theme) }, QUEST_THEMES[theme].label)),
      ),
      h("button", { class: "ghost", onclick: () => this.close() }, "Close"),
    );
  }

  private async make(theme: QuestTheme): Promise<void> {
    this.element.replaceChildren(h("div", { class: "spinner" }), h("p", { class: "center-text", text: `Muse Spark is planning “${QUEST_THEMES[theme].label}”…` }));
    const outcome = await requestQuest(questPlaces(this.shops), theme);
    if (!outcome) {
      this.element.replaceChildren(
        h("p", { text: "This street has too few places of the right kinds for that theme. Try another one." }),
        h("button", { onclick: () => this.showThemes() }, "Another theme"),
      );
      return;
    }
    this.showQuest(outcome);
  }

  private showQuest({ quest, note }: QuestOutcome): void {
    const byId = new Map(this.shops.map((s) => [s.id, s]));
    const stops = quest.stops.map((stop) => ({ stop, shop: byId.get(stop.id) })).filter((x): x is { stop: Quest["stops"][number]; shop: ShopAhead } => x.shop !== undefined);
    const list = h(
      "ol",
      { class: "quest-stops" },
      ...stops.map(({ stop, shop }, i) =>
        h(
          "li",
          {},
          h("span", { class: "quest-num", style: `background:${CATEGORY_STYLE[shop.category].color}`, text: String(i + 1) }),
          h(
            "div",
            {},
            h("strong", { text: shop.name }),
            h("span", { class: "muted small", text: ` · ${distanceText(shop.s)} on the ${shop.side}` }),
            h("p", { text: stop.line }),
          ),
        ),
      ),
    );
    this.element.replaceChildren(
      h("div", { class: "quest-kicker", text: quest.source === "muse-spark-open" ? "✦ Quest by Muse Spark" : "Quest" }),
      h("h3", { text: quest.title }),
      list,
      h("p", { class: "muted small", text: note }),
      h(
        "div",
        { class: "row wrap" },
        h("button", { class: "primary", onclick: () => this.onStart(quest, stops.map((x) => x.shop)) }, "Start the quest"),
        h("button", { onclick: () => this.showThemes() }, "Another theme"),
        h("button", { class: "ghost", onclick: () => this.close() }, "Close"),
      ),
    );
  }
}
