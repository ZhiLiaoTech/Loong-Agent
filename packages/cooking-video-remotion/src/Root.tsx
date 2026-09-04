import React from "react";
import { Composition } from "remotion";
import { CookingPromo } from "./CookingPromo";
import type { CookingPromoProps } from "./types";

const defaultProps: CookingPromoProps = {
  clips: [],
  durationMs: 15000,
  brand: {
    primaryColor: "#1D1D1B",
    accentColor: "#E75B2A",
    textColor: "#FFFFFF",
    fontFamily: "Microsoft YaHei, sans-serif",
    endCardHeadline: "让每一道菜都稳定出品",
  },
};

export const RemotionRoot: React.FC = () => <>
  <Composition id="CookingPromo15" component={CookingPromo} width={1080} height={1920} fps={30} durationInFrames={450} defaultProps={defaultProps} />
  <Composition id="CookingPromo30" component={CookingPromo} width={1080} height={1920} fps={30} durationInFrames={900} defaultProps={{ ...defaultProps, durationMs: 30000 }} />
</>;
