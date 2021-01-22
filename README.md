# React bindings for the Hyper Hyper Space

This library enables using HHS objects as state for React components.

Since HHS is a peer-to-peer data layer, the normal set-up is for the webapp to run a full HHS peer inside the browser. The bindings in this library give access to (parts of) your component hierarchy to such a peer, and then bind particular components to HHS live objects.

So, instead of fetching state from a server, the bound components are kept in sync with the state of the local copies of the objects, that are updated in real time by the local HHS peer.

You can see a simple example in [this chat client](https://github.com/hyperhyperspace/p2p-chat-web) based on HHS. 