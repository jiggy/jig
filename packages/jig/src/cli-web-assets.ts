/** Private fixed host assets. The installed CLI build embeds their exact bytes here. */
export type PrivateWebAssets = Readonly<
  Record<string, Readonly<{ body: string; contentType: string }>>
>

// An unbuilt source CLI cannot silently serve a checkout-relative development UI.
export const privateWebAssets: PrivateWebAssets = Object.freeze({})
