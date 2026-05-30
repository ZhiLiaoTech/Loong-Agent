export type Locale = "zh-CN" | "en";

export type MessageTree = {
  readonly [key: string]: string | MessageTree;
};
