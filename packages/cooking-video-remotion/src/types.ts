export interface PromoClip {
  id: string;
  src: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  caption?: string;
  sellingPoint?: string;
  focusX?: number;
  focusY?: number;
  sourceVolume?: number;
}

export type CookingPromoProps = Record<string, unknown> & {
  clips: PromoClip[];
  durationMs: 15000 | 30000;
  brand: {
    primaryColor: string;
    accentColor: string;
    textColor: string;
    fontFamily: string;
    logoSrc?: string;
    endCardHeadline: string;
    endCardSubline?: string;
  };
  music?: { src: string; volume: number };
};
