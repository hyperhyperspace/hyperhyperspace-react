import { Hash, HashedObject, LinkupAddress, MutableObject, MutationEvent, MutationObserver, MutationOp, ObjectBroadcastAgent, ObjectDiscoveryReply, Resources, Space, SpaceEntryPoint, SpaceInit, SyncEvent, SyncObserver, SyncState, WordCode } from '@hyper-hyper-space/core';
import { AsyncStream } from '@hyper-hyper-space/core/dist/util/streams';
import React, { useContext, useState, useEffect, useRef } from 'react';


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

class ObjectState<T extends HashedObject> {

    value?: T;
    debounceFreq?: React.MutableRefObject<number | undefined>;
    debounceTimeout?: React.MutableRefObject<number | undefined>;
    setObjectState?: React.MutableRefObject<React.Dispatch<React.SetStateAction<ObjectState<T> | undefined>> | undefined>;

    constructor(obj?: T, debounceFreq?: React.MutableRefObject<number | undefined>, debounceTimeout?: React.MutableRefObject<number | undefined>, setObjectState?: React.MutableRefObject<React.Dispatch<React.SetStateAction<ObjectState<T> | undefined>> | undefined>) {
        this.value = obj;
        this.debounceFreq = debounceFreq;
        this.debounceTimeout = debounceTimeout;
        this.setObjectState = setObjectState;
    }

    getValue(): T|undefined {
        return this.value;
    }

    getDebounceFreq() {
        return this.debounceFreq?.current;
    }

    setDebounceFreq(val: number|undefined) {
        if (this.debounceFreq === undefined || this.debounceTimeout === undefined || this.setObjectState === undefined) {
            throw new Error('Cannot set new debounce frequency.');
        }

        if (this.debounceTimeout.current !== undefined) {
            this.debounceTimeout.current = undefined;
            window.setTimeout(() => {
                if (this.setObjectState !== undefined) {
                    this.setObjectState.current!(new ObjectState(this.value, this.debounceTimeout, this.debounceTimeout, this.setObjectState));
                }
            }, 0);
            
        }

        this.debounceFreq.current = val;
    }
}

// This function loads the object by its hash from the store and sets up store watching.

const loadAndUseObjectState = <T extends HashedObject>(hash?: Hash, renderOnLoadAll=false) => {

    const resources = usePeerResources();
    const [objectState, setObjectSate] = useState<ObjectState<T> | undefined> (undefined);

    useEffect(() => {

        let destroyed = false;
        let obj: T | undefined = undefined;

        let mutCallback = (_mut: MutationOp) => {
            if (obj !== undefined) {
                setObjectSate(new ObjectState(obj));
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
                                setObjectSate(new ObjectState(obj as any as T));
                                if (!renderOnLoadAll) {
                                    obj.addMutationOpCallback(mutCallback);    
                                }
                            }
                        });
                    }
                    if (!destroyed) {
                        setObjectSate(new ObjectState(obj as any as T));
                    }
                }
            });
        }


        return () => {

            destroyed = true;

            if (hash !== undefined && obj !== undefined && obj instanceof MutableObject) {
                obj.dontWatchForChanges();
                obj.deleteMutationOpCallback(mutCallback);
            }  
        };
    }, [resources, hash]);

    return objectState;

 };

const useSyncStates: ((objs: Array<[mut: MutableObject, peerGroupId: string]>) => {[key: Hash]: SyncState}) = (objs: Array<[mut: MutableObject, peerGroupId: string]>) => {

    const [objectSyncStates, setObjectSyncStates] = useState<{[key: Hash]: SyncState}>({});

    const observers = useRef<Map<Hash, [MutableObject, string, MutationObserver]>>(new Map());

    useEffect(() => {


        const unseen = new Set(Object.keys(objectSyncStates));

        for (const [mut, peerGroupId] of objs) {

            const hash = mut.getLastHash();

            unseen.delete(hash);

            if (!observers.current.has(hash)) {

                const obs = (ev: MutationEvent) => {

                    const states = {...objectSyncStates};

                    states[hash] = ev.data;

                    setObjectSyncStates(states);
                }

                observers.current.set(hash, [mut, peerGroupId, obs]);

                mut.getSyncState(peerGroupId).then((syncState?: SyncState) => {
                    
                    mut.addSyncObserver(obs, peerGroupId);
                    if (syncState !== undefined) {

                        const states = {...objectSyncStates};

                        states[hash] = syncState;

                        setObjectSyncStates(states)
                    }
                    
                }).catch((e: any) => {
                    console.log('Error retrieving initial state: ' + e);
                });
            }
        }

        if (unseen.size > 0) {
            const newSyncStates: {[key: Hash]: SyncState} = {...objectSyncStates};

            for (const hash of unseen) {
                const pair = observers.current.get(hash);

                if (pair !== undefined) {
                    const [mut, peerGroupId, obs] = pair;

                    mut.removeSyncObserver(obs, peerGroupId);
                    observers.current.delete(mut.getLastHash());

                    delete newSyncStates[hash];
                }
            }

            setObjectSyncStates(newSyncStates);
        }

        return () => {
            for (const [mut, peerGroupId, obs] of observers.current.values()) {
                mut.removeSyncObserver(obs, peerGroupId);
                observers.current.delete(mut.getLastHash());
            }
        }
    }, [objs]);

    return objectSyncStates;

 };

const useSyncState = (objOrPromise?: MutableObject | Promise<MutableObject | undefined>, peerGroupId?: string) => {

    const [objectSyncState, setObjectSyncState] = useState<SyncState|undefined>()

    let loadedObj: MutableObject|undefined = undefined; 

    useEffect(() => {
        let prom: Promise<MutableObject | undefined> | undefined;

        if (objOrPromise instanceof Promise) {
            prom = objOrPromise;
        } else if (objOrPromise !== undefined) {
            prom = Promise.resolve(objOrPromise);
        } else {
            prom = undefined;
        }

        let destroyed = false;

        const obs: SyncObserver = (ev: SyncEvent) => {
            console.log('new sync state for ' + loadedObj?.getLastHash(), ev.data);
            setObjectSyncState(ev.data);
        };

        prom?.then(async obj => {

            if (obj !== undefined && peerGroupId !== undefined) {
                if (obj instanceof MutableObject) {

                    loadedObj = obj;

                    if (!destroyed) {
                        obj.addSyncObserver(obs, peerGroupId);

                        const initial = await obj.getSyncState(peerGroupId);
                        setObjectSyncState(initial);
                        console.log('initial sync state for ' + loadedObj?.getLastHash(), initial);
                    }
                    
                }
            }
        });

        return () => {
            destroyed = true;

            if (loadedObj !== undefined && loadedObj instanceof MutableObject) {
                loadedObj.removeSyncObserver(obs, peerGroupId);
            }
        }
    }, [objOrPromise, peerGroupId]);

    return objectSyncState;

};


// This binding uses the object as-is: it doesn't attempt to set up store watching.
// The caller should pass an object that's ready (bound to the store, etc.).

const useObjectState = <T extends HashedObject>(objOrPromise?: T | Promise<T | undefined>, options?: {filterMutations?:(ev: MutationEvent) => boolean, debounceFreq?: number}) => {


    const init = objOrPromise instanceof HashedObject? objOrPromise : undefined;
    
    
    const debounceFreq = useRef<number|undefined>(options?.debounceFreq);
    const fireTimeout = useRef<number>();
    const setObjectStateRef = useRef<React.Dispatch<React.SetStateAction<ObjectState<T> | undefined>>>();
    
    const [objectState, setObjectState] = useState<ObjectState<T> | undefined> (new ObjectState(init, debounceFreq, fireTimeout, setObjectStateRef ));
    setObjectStateRef.current = setObjectState;
    
    

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

        

        let mutObserver: MutationObserver =
            (ev: MutationEvent) => {
                //console.log('new state for ' + loadedObj?.hash() + ':');
                //console.log(ev)
                if (options?.filterMutations === undefined || options.filterMutations(ev)) {

                    if (debounceFreq.current === undefined) {
                        setObjectState(new ObjectState(loadedObj, debounceFreq, fireTimeout, setObjectStateRef));
                    } else {
                        if (fireTimeout.current !== undefined) {
                            clearTimeout(fireTimeout.current);
                        }

                        fireTimeout.current = window.setTimeout(() => {
                            setObjectState(new ObjectState(loadedObj, debounceFreq, fireTimeout, setObjectStateRef));
                        }, debounceFreq.current);
                    }
                    
                } else { 
                    //console.log('rejecting:');
                    //console.log(ev);
                }
            };
        

        prom?.then(obj => {

            loadedObj = obj;

            if (obj !== undefined) {

                if (obj instanceof HashedObject) {
                    obj.addObserver(mutObserver);
                    /*if (renderOnLoadAll) {
                        obj.addObserver(mutObserver);
                        //obj.addMutationOpCallback(mutCallback);
                    }
                    obj.loadAndWatchForChanges().then(() => {
                        if (!destroyed) {
                            setStateObject(new StateObject(obj));
                            if (!renderOnLoadAll) {
                                obj.addObserver(mutObserver);
                                //obj.addMutationOpCallback(mutCallback);
                            }
                        }
                    });*/
                }
                if (!destroyed) {
                    setObjectState(new ObjectState(obj, debounceFreq, fireTimeout, setObjectStateRef));
                    //console.log('set initial value for ' + obj.hash(), obj)
                }
            }
    
        });


        return () => {

            destroyed = true;

            if (loadedObj !== undefined && loadedObj instanceof HashedObject) {
                //loadedObj.watchForChanges(false);
                loadedObj.removeObserver(mutObserver);
                //loadedObj.deleteMutationOpCallback(mutCallback);
            }

            if (fireTimeout.current !== undefined) {
                clearInterval(fireTimeout.current);
            }
        };
    }, [objOrPromise]);

    return objectState;

 };

 const useObjectDiscovery = (wordCode?: string, lang='en', count=10, includeErrors=false) => {
    return useObjectDiscoveryWithResources(usePeerResources(), wordCode, lang, count, includeErrors);
 }


 const useObjectDiscoveryWithResources = (resources?: Resources, wordCode?: string, lang='en', count=10, includeErrors=false) => {

    const [results, setResults] = useState<Map<Hash, ObjectDiscoveryReply>>(new Map());
    
    const words = wordCode !== undefined? wordCode.split('-') : undefined;
    
    useEffect(() => {
        if (words !== undefined && resources !== undefined) {

            const wordcoder = WordCode.lang.get(lang);

            if (wordcoder === undefined) {
                throw new Error('Unknown language for decoding word code: ' + lang);
            }
        
            const suffix = wordcoder.decode(words);
        
            return performDiscovery(resources, suffix, setResults, count, includeErrors);
        }

        return undefined;
    }, [resources, wordCode, lang, count]);
    
    return results;
 }

 const useObjectDiscoveryIfNecessary = <T extends HashedObject>(resources?: Resources, hash?: Hash, object?: T) => {

    const [result, setResult] = useState<T>();

     const [discoveryResults, setDiscoveryResults] = useState<Map<Hash, ObjectDiscoveryReply>>(new Map());

     useEffect(() => {
        let cleanUp: (()=>void) | undefined = undefined;

        if (object !== undefined) {
            setResult(object);
        } else if (hash !== undefined && resources !== undefined) {
            const suffix = ObjectBroadcastAgent.hexSuffixFromHash(hash, ObjectBroadcastAgent.defaultBroadcastedSuffixBits);
            cleanUp = performDiscovery(resources, suffix, setDiscoveryResults, 1, false);
        }

        return cleanUp;

     }, [resources, hash, object]);

     useEffect(() => {

        if (discoveryResults.size > 0) {
            const discovered = discoveryResults.values().next().value as ObjectDiscoveryReply;

            if (discovered.error === undefined && discovered.object !== undefined && result === undefined) {
                if (discovered.object.getLastHash() === hash) {
                    setResult(discovered.object as T);
                }
                
            }
        }

     }, [discoveryResults]);

     return result;
 }

 const performDiscovery = (resources: Resources, suffix: string, setResults: React.Dispatch<React.SetStateAction<Map<string, ObjectDiscoveryReply>>>, count: number, includeErrors: boolean) => {
    if (resources.config.peersForDiscovery === undefined) {
        throw new Error('Trying to do object discovery for hash suffix ' + suffix + ', but config.peersForDiscovery is undefined.');
    }

    const linkupServers = resources.config.linkupServers;
    const discoveryAddress = LinkupAddress.fromURL(resources.config.peersForDiscovery[0].endpoint, resources.config.peersForDiscovery[0].identity);
    
    const replyStream = resources.mesh.findObjectByHashSuffix(suffix, linkupServers, discoveryAddress, count, 30, false, includeErrors);

    const currentResults = new Map();
    processReplyStream(replyStream as AsyncStream<ObjectDiscoveryReply>, currentResults, setResults);

    return () => {
        replyStream.close();
        setResults(new Map());
    };
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
        console.log('processing reply stream:')
        console.log(e);
        // done, timeouted or completed
    }

 }


export { ObjectState, PeerResources, usePeerResources, PeerResourcesUpdater, usePeerResourcesUpdater, 
         useSpace, useObjectState, loadAndUseObjectState, useObjectDiscovery, 
         useObjectDiscoveryWithResources, useObjectDiscoveryIfNecessary,
         useSyncState, useSyncStates };