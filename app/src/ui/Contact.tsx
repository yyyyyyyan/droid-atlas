/**
 * The project's contact address as a link that opens it: a mail address in
 * the reader's mail app, a web address in a new tab. The address is the
 * link's own text, so a reader whose browser opens nothing for it can still
 * read it and copy it.
 */

export interface Contact {
  label: string;
  href: string;
}

/** The attributes that open a contact: a web address leaves the app in a new tab, a mail address does not. */
export function contactTarget(contact: Contact): { href: string; target?: string; rel?: string } {
  return contact.href.startsWith("mailto:")
    ? { href: contact.href }
    : { href: contact.href, target: "_blank", rel: "noopener" };
}

/** The address inside a sentence, as the link that opens it. */
export function ContactAddress({ contact }: { contact: Contact }) {
  return <a {...contactTarget(contact)} class="contact-address" translate={false}>{contact.label}</a>;
}
