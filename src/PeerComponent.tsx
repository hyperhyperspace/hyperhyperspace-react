import { Resources } from '@hyper-hyper-space/core';
import { ReactNode, useState } from 'react';
import { PeerResources, PeerResourcesUpdater } from './bindings';
import React from 'react';

function PeerComponent(props: {resources?: Resources, children: ReactNode}) {

    const [resources, setResources] = useState<Resources>(props.resources || new Resources());

    return (
        <PeerResources.Provider value={resources}>
            <PeerResourcesUpdater.Provider value={setResources}>
                {props.children}
            </PeerResourcesUpdater.Provider>
        </PeerResources.Provider>
    );
}

export { PeerComponent };