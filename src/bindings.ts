import { Hash, HashedObject, MutableObject, MutationEvent, MutationObserver, MutationOp, ObjectDiscoveryReply, Resources, Space, SpaceEntryPoint, SpaceInit, WordCode } from '@hyper-hyper-space/core';
import { AsyncStream } from '@hyper-hyper-space/core/dist/util/streams';
import React, { useContext, useState, useEffect } from 'react';


const PeerResources = React.createContext<Resources>(undefined as any as Resources);
const PeerResourcesUpdater = React.createContext<React.Dispatch<React.SetStateAction<Resources>>>(() => { });

const usePeerResources: () => Resources = () => {
    return useContext(PeerResources);
}

const usePeerResourcesUpdater: () => React.Dispatch<React.SetStateAction<Resources>> = () => {
    return useContext(PeerResourcesUpdater);
} 

const useSpace = <T extends HashedObject>(init?: SpaceInit, broadcast?: boolean, sync=true) => {
    const resources = usePeerResources();

    const [entryPoint, setEntryPoint] = useState<HashedObject|undefined>(undefined);

    useEffect(() => {

        const space = init !== undefined? new Space(init, resources) : undefined;
        let initialized = false;
        let destroyed = false;

        const doBroadcast = broadcast !== undefined? broadcast : init?.wordCode !== undefined;

        if (space !== undefined && init !== undefined) {
            
            
            space.entryPoint.then(async (obj: HashedObject & SpaceEntryPoint) => {
                if (!destroyed) {

                    if (doBroadcast) {
                        space.startBroadcast();
                    }

                    obj.setResources(resources);
                    if (resources.store) {
                        await resources.store.save(obj);
                    }

                    if (sync) {
                        obj.startSync();
                    }

                    setEntryPoint(obj);

                    initialized = true;
                }
                
            });
        }

        return () => {
            destroyed = true;

            if (initialized) {
                if (doBroadcast) {
                    space?.stopBroadcast();
                }

                space?.getEntryPoint().then((obj: HashedObject & SpaceEntryPoint) => {
                    obj.stopSync();
                });
            }
            
        };
    }, [init, broadcast, resources]);

    return entryPoint as T|undefined;

};

class StateObject<T extends HashedObject> {

    value?: T;

    constructor(obj?: T) {
        this.value = obj;
    }
}

// This function loads the object by its hash from the store and sets up store watching.

const useStateObjectByHash = <T extends HashedObject>(hash?: Hash, renderOnLoadAll=false) => {

    const resources = usePeerResources();
    const [stateObject, setSateObject] = useState<StateObject<T> | undefined> (undefined);

    useEffect(() => {

        let destroyed = false;
        let obj: T | undefined = undefined;

        let mutCallback = (_mut: MutationOp) => {
            if (obj !== undefined) {
                setSateObject(new StateObject(obj));
            }
        };

        if (hash !== undefined) {
            resources.store?.load(hash).then((obj: HashedObject|undefined) => {
                if (obj !== undefined) {
                    if (obj instanceof MutableObject) {
                        if (renderOnLoadAll) {
                            obj.addMutationOpCallback(mutCallback);    
                        }
                        
                        obj.loadAndWatchForChanges().then(() => {
                            if (!destroyed) {
                                setSateObject(new StateObject(obj as any as T));
                                if (!renderOnLoadAll) {
                                    obj.addMutationOpCallback(mutCallback);    
                                }
                            }
                        });
                    }
                    if (!destroyed) {
                        setSateObject(new StateObject(obj as any as T));
                    }
                }
            });
        }


        return () => {

            destroyed = true;

            if (hash !== undefined && obj !== undefined && obj instanceof MutableObject) {
                obj.watchForChanges(false);
                obj.deleteMutationOpCallback(mutCallback);
            }  
        };
    }, [resources, hash]);

    return stateObject;

 };



// This binding uses the object as-is: it doesn't attempt to set up store watching.
// The caller should pass an object that's ready (bound to the store, etc.).

const useStateObject = <T extends HashedObject>(objOrPromise?: T | Promise<T | undefined>, renderOnLoadAll=false) => {

    const init = objOrPromise instanceof HashedObject? objOrPromise : undefined;
    const [stateObject, setStateObject] = useState<StateObject<T> | undefined> (new StateObject(init));

    useEffect(() => {

        let prom: Promise<T | undefined> | undefined;

        if (objOrPromise instanceof Promise) {
            prom = objOrPromise;
        } else if (objOrPromise !== undefined) {
            prom = Promise.resolve(objOrPromise);
        } else {
            prom = undefined;
        }

        let loadedObj: T | undefined;

        let destroyed = false;
        //let mutCallback = (_mut: MutationOp) => {
        //    setStateObject(new StateObject(loadedObj));
        //}

        let mutObserver: MutationObserver = {
            callback: (_ev: MutationEvent) => {
                setStateObject(new StateObject(loadedObj));
            }
        };
        

        prom?.then(obj => {

            loadedObj = obj;

            if (obj !== undefined) {

                if (obj instanceof MutableObject) {
                    if (renderOnLoadAll) {
                        obj.addMutationObserver(mutObserver);
                        //obj.addMutationOpCallback(mutCallback);
                    }
                    obj.loadAndWatchForChanges().then(() => {
                        if (!destroyed) {
                            setStateObject(new StateObject(obj));
                            if (!renderOnLoadAll) {
                                obj.addMutationObserver(mutObserver);
                                //obj.addMutationOpCallback(mutCallback);
                            }
                        }
                    });
                }
                if (!destroyed) {
                    setStateObject(new StateObject(obj));
                }
            }
    
        });


        return () => {

            destroyed = true;

            if (loadedObj !== undefined && loadedObj instanceof MutableObject) {
                loadedObj.watchForChanges(false);
                loadedObj.removeMutationObserver(mutObserver);
                //loadedObj.deleteMutationOpCallback(mutCallback);
            }  
        };
    }, [objOrPromise]);

    return stateObject;

 };

 const useObjectDiscovery = (wordCode?: string, lang='en', count=10, includeErrors=false) => {

    const resources = usePeerResources();
    const [results, setResults] = useState<Map<Hash, ObjectDiscoveryReply>>(new Map());
    
    const words = wordCode !== undefined? wordCode.split('-') : undefined;
    
    useEffect(() => {
        if (words !== undefined) {

            const wordcoder = WordCode.lang.get(lang);

            if (wordcoder === undefined) {
                throw new Error('Unknown language for decoding word code: ' + lang);
            }
        
            const suffix = wordcoder.decode(words);
        
            if (resources.config.peersForDiscovery === undefined) {
                throw new Error('Trying to do object discovery for words ' + words.join('-') + ', but config.peersForDiscovery is undefined.');
            }
        
            const linkupServers = resources.config.linkupServers;
            const discoveryEndpoint = resources.config.peersForDiscovery[0].endpoint;
            
            const replyStream = resources.mesh.findObjectByHashSuffix(suffix, linkupServers, discoveryEndpoint, count, 30, false, includeErrors);

            const currentResults = new Map();
            processReplyStream(replyStream as AsyncStream<ObjectDiscoveryReply>, currentResults, setResults);

            return () => {
                replyStream.close();
                setResults(new Map());
            };
        }

        return undefined;
    }, [wordCode, lang, count]);
    


    return results;
 }

 const processReplyStream = async (replyStream: AsyncStream<ObjectDiscoveryReply>, currentResults: Map<Hash, ObjectDiscoveryReply>, setResults: (r: Map<Hash, ObjectDiscoveryReply>) => void) => {

    try {
        while (true) {
            let next = await replyStream.next(30000);
            
            const current = currentResults.get(next.hash);

            if (current === undefined || (current.object === undefined && next.object !== undefined)) {
                currentResults.set(next.hash, next);
                setResults(new Map(currentResults.entries()));
            }            
        }
    } catch (e: any) {
        // done, timeouted or completed
    }

 }


export { StateObject, PeerResources, usePeerResources, PeerResourcesUpdater, usePeerResourcesUpdater, useSpace, useStateObject, useStateObjectByHash, useObjectDiscovery };