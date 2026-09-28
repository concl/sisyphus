/**
 * Whether a growing transcript should be followed to its end.
 *
 * A reply that streams is worth following only while the reader is at the end of
 * it. Scrolling back into history is the reader saying "I am reading this, stop
 * moving", and coming back to the end is them saying "carry on" - so the follow
 * is theirs to give and take, not the transcript's, and a reply that arrives while
 * nobody is following is simply left below the fold.
 *
 * Two things are also wanting to watch, whatever came before: opening a
 * conversation (it opens at its newest content) and sending a turn (the reader
 * wants to see what the model does with it). Finishing a reply is not one of them:
 * an answer that lands under a reader who scrolled away must not pull them down.
 */

/** A scroller, in the terms the browser states it. */
export interface Scroller {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * How close to the end still counts as being at the end. A streamed reply can grow
 * between two scroll events, and a trackpad can come to rest a pixel or two short,
 * so the end needs a little slack before a reader is called away from it.
 */
export const BOTTOM_SLACK = 24

/** Whether this position is the end of the transcript, within the slack. */
export function atEnd(position: Scroller, slack = BOTTOM_SLACK): boolean {
  return position.scrollHeight - position.scrollTop - position.clientHeight <= slack
}

/** What the transcript is following, and what it last saw. */
export class Follow {
  private readonly slack: number
  private following = true
  private thread = ''
  private newest = ''

  constructor(slack = BOTTOM_SLACK) {
    this.slack = slack
  }

  /** True while growing content should be scrolled to its end. */
  get active(): boolean {
    return this.following
  }

  /** Where the reader is now: at the end, or somewhere in the history. */
  observe(position: Scroller): void {
    this.following = atEnd(position, this.slack)
  }

  /**
   * A turn or message arrived. A conversation the reader has moved to, and a turn
   * they just sent, start following. Anything else keeps the follow they chose.
   */
  watch(threadId: string, newestId: string, newestRole: string): void {
    if (this.thread !== threadId || (newestRole === 'user' && this.newest !== newestId))
      this.following = true
    this.thread = threadId
    this.newest = newestId
  }
}
