/**
 * A chat message a navigation asked to show (a mention or new-message
 * notification, shared-items step 5): once its work item resolves, the view
 * reads the message, opens the chat holding it and scrolls to it.
 */
export interface RequestedMessage {
  workItemId: string;
  messageId: string;
}
