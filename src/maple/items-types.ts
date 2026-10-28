/**
 * Manifest section written by scripts/fetch-maple-items.ts (Item.wz icons, scrolls, the pet; Effect.wz enchant effects).
 * Type-only module, no side effects.
 */
import type { ScrollEntry } from '../game/scrolls.ts';
import type { AtlasRef } from './world-types.ts';

/** Roles of the item icons: the frame `action` in the icon atlas that stands in for each pickup. */
export interface ItemIconKeys {
  /** Red / Orange / White Potion (2000000..2000002) and Elixir / Power Elixir (2000004, 2000005); each a single frame */
  potionRed?: string;
  potionOrange?: string;
  potionWhite?: string;
  elixir?: string;
  elixirPower?: string;
  /** Meso bronze / gold / bundle / bag (09000000..09000003): animated, frames 0..n of the action */
  mesoBronze?: string;
  mesoGold?: string;
  mesoBundle?: string;
  mesoBag?: string;
  /** Gachapon Ticket (Cash/0522.img/05220000): the boss capsule, a single frame */
  gacha?: string;
  /** Field items: Apple (Consume 2010000), 2x EXP Coupon, Warrior Elixir, Ludibrium Clock, Powder Keg (guessed ids, see FIELD_ICONS in scripts/fetch-maple-items.ts); a single frame each */
  fieldApple?: string;
  fieldCoupon?: string;
  fieldElixir?: string;
  fieldClock?: string;
  fieldKeg?: string;
}

export interface PetSection extends AtlasRef {
  /** item id, e.g. '5000000' */
  id: string;
  /** String.wz Pet.img name, e.g. 'Brown Kitty' */
  name: string;
  /** frame actions present: 'stand0', 'move', 'jump' (a subset) */
  actions: string[];
}

export interface ItemsSection {
  /** potions, elixirs, mesos and scroll icons. Frame `action` = 8-digit item id ('02000000'), `index` = animation frame */
  icons?: AtlasRef;
  keys?: ItemIconKeys;
  /** String.wz Consume.img scrolls by id (the ~30 chosen ones); their icon is the frame with action '0' + id when present */
  scrolls?: Record<string, ScrollEntry>;
  pet?: PetSection;
  /** Effect.wz BasicEff.img Enchant: frame actions 'success' and 'failure' */
  enchant?: AtlasRef;
}
