import type { DecoratorContext, Type } from '@typespec/compiler'

export const invocationKey = Symbol('invocation')
export const closedKey = Symbol('closed')
export const oneOfKey = Symbol('oneOf')
export const projectionKey = Symbol('projection')
export const channelKey = Symbol('channel')

export const library = `
import "./decorators.js";
using TypeSpec.Reflection;
namespace FLOW;
extern dec invocation(target: Namespace, input: unknown, result: unknown, options?: valueof unknown);
extern dec closed(target: Model);
extern dec oneOf(target: Union);
extern dec agentResponse(target: Model, path: valueof string);
extern dec channelContract(target: Model, path: valueof string, options: valueof unknown);
`

export const decorators = {
  $decorators: {
    FLOW: {
      invocation(
        context: DecoratorContext,
        target: Type,
        input: Type,
        result: Type,
        options?: unknown,
      ) {
        context.program.stateMap(invocationKey).set(target, {
          input,
          result,
          options: options ?? {},
        })
      },
      closed(context: DecoratorContext, target: Type) {
        context.program.stateMap(closedKey).set(target, true)
      },
      oneOf(context: DecoratorContext, target: Type) {
        context.program.stateMap(oneOfKey).set(target, true)
      },
      agentResponse(context: DecoratorContext, target: Type, path: string) {
        context.program.stateMap(projectionKey).set(target, path)
      },
      channelContract(context: DecoratorContext, target: Type, path: string, options: unknown) {
        context.program.stateMap(channelKey).set(target, { path, options })
      },
    },
  },
}
