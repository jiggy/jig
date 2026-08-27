/**
 * Unstable Hook authoring overlay. It is intentionally separate from the
 * frozen Project Authoring SDK/1 root and may be removed before publication.
 */
export {
  bindingRef,
  candidates,
  defineBinding,
  definePrivateHookJig as defineJig,
  defineHook,
  defineJournalPublisher,
  discover,
  flowRef,
  type BindingRef,
  type FlowRef,
  type HookInput,
  type JournalPublisherInput,
  type PackageBindingInput,
  type PrivateHookJigDefinitionInput as JigDefinitionInput,
  type RunTargetRef,
} from "../project/author.js";
