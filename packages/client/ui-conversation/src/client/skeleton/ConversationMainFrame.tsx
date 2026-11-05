/** Native Conversation outlet shared with optional main-surface layouts. */
import type { FactoryComponentPropsOf, FactoryLocalComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contract/slots.ts'

type BodyProps = FactoryLocalComponentPropsOf<'conversation.main.frame', 'body'>

function NativeConversation({ renderSlot }: BodyProps) {
  return renderSlot('main.conversation', {})
}

/**
 * Compose the native Conversation with the caller's layout through a Factory-local Component.
 * @param props - Factory rendering capabilities.
 * @returns The selected frame with its authorized native Conversation outlet.
 */
export function ConversationMainFrame(props: FactoryComponentPropsOf<'conversation.main.frame'>) {
  const Body = props.useFactorySlot('body', NativeConversation)
  return <Body />
}
