import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { CookingPromoProps, PromoClip } from "./types";

const msToFrames = (milliseconds: number, fps: number): number => Math.round(milliseconds / 1000 * fps);

const Clip: React.FC<{ clip: PromoClip; fontFamily: string; textColor: string; accentColor: string }> = ({ clip, fontFamily, textColor, accentColor }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const duration = msToFrames(clip.sourceEndMs - clip.sourceStartMs, fps);
  const opacity = interpolate(frame, [0, Math.min(8, duration / 4), Math.max(8, duration - 8), duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "#111", overflow: "hidden" }}>
    <OffthreadVideo
      src={clip.src}
      startFrom={msToFrames(clip.sourceStartMs, fps)}
      endAt={msToFrames(clip.sourceEndMs, fps)}
      volume={clip.sourceVolume ?? 0.4}
      style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${(clip.focusX ?? 0.5) * 100}% ${(clip.focusY ?? 0.5) * 100}%` }}
    />
    {clip.sellingPoint ? <div style={{ position: "absolute", top: 150, left: 72, padding: "14px 22px", borderRadius: 10, background: accentColor, color: textColor, fontFamily, fontSize: 38, fontWeight: 700, opacity }}>{clip.sellingPoint}</div> : null}
    {clip.caption ? <div style={{ position: "absolute", left: 86, right: 86, bottom: 170, padding: "20px 28px", borderRadius: 14, background: "rgba(0,0,0,.62)", color: textColor, fontFamily, fontSize: 46, fontWeight: 700, lineHeight: 1.25, textAlign: "center", opacity }}>{clip.caption}</div> : null}
  </AbsoluteFill>;
};

export const CookingPromo: React.FC<CookingPromoProps> = ({ clips, durationMs, brand, music }) => {
  const { fps } = useVideoConfig();
  const contentEndMs = clips.reduce((maximum, clip) => Math.max(maximum, clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs), 0);
  const endCardFrames = msToFrames(Math.max(0, durationMs - contentEndMs), fps);
  return <AbsoluteFill style={{ backgroundColor: brand.primaryColor, fontFamily: brand.fontFamily }}>
    {clips.map(clip => <Sequence key={clip.id} from={msToFrames(clip.timelineStartMs, fps)} durationInFrames={msToFrames(clip.sourceEndMs - clip.sourceStartMs, fps)}>
      <Clip clip={clip} fontFamily={brand.fontFamily} textColor={brand.textColor} accentColor={brand.accentColor} />
    </Sequence>)}
    {music ? <Audio src={music.src} volume={music.volume} /> : null}
    <Sequence from={msToFrames(contentEndMs, fps)} durationInFrames={endCardFrames}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34, background: `linear-gradient(145deg, ${brand.primaryColor}, ${brand.accentColor})`, color: brand.textColor }}>
        {brand.logoSrc ? <Img src={brand.logoSrc} style={{ width: 260, maxHeight: 180, objectFit: "contain" }} /> : null}
        <div style={{ width: 850, textAlign: "center", fontSize: 68, fontWeight: 800, lineHeight: 1.15 }}>{brand.endCardHeadline}</div>
        {brand.endCardSubline ? <div style={{ fontSize: 34, opacity: 0.86 }}>{brand.endCardSubline}</div> : null}
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>;
};
