# Security policy

This page explains how to report a security problem in Droid Atlas.

## Report a vulnerability

Write to security@droidatlas.app. Describe what an attacker can do and the steps
to reproduce it. Don't open a public issue for a vulnerability.

You get a reply at the address you wrote from. A fix reaches the site with the
next build after it is merged.

## What counts

Droid Atlas is a static site with no accounts and no server-side code. Its
catalog is built from lists and indexes that anyone can propose changes to, so
the build treats their text as untrusted. Problems that matter here include:

- text from a source that runs as code or markup in the app
- a link built by the app that opens something other than the page or app it
  names
- the site sending a request to another site before you select a link
- the build publishing a catalog that its checks should have refused

## What is out of scope

Droid Atlas doesn't review the apps it lists. To report a vulnerability in a
listed app, write to that app's developers.
