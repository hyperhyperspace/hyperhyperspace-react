import { Hash, HashedObject, MutableObject, MutationOp, Resources, Space, SpaceEntryPoint, SpaceInit } from '@hyper-hyper-space/core';
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
        let mutCallback = (_mut: MutationOp) => {
            setStateObject(new StateObject(loadedObj));
        }

        

        prom?.then(obj => {

            loadedObj = obj;

            if (obj !== undefined) {

                if (obj instanceof MutableObject) {
                    if (renderOnLoadAll) {
                        obj.addMutationOpCallback(mutCallback);
                    }
                    obj.loadAndWatchForChanges().then(() => {
                        if (!destroyed) {
                            console.log('@hyper-hyper-space/react: State loaded for ' + obj.hash());
                            console.log((obj as any)._loadedAllChanges)
                            setStateObject(new StateObject(obj));
                            if (!renderOnLoadAll) {
                                obj.addMutationOpCallback(mutCallback);
                            }
                        }
                    });
                }
                if (!destroyed) {
                    console.log('@hyper-hyper-space/react: Loaded ' + obj.hash());
                    setStateObject(new StateObject(obj));
                }
            }
    
        });


        return () => {

            destroyed = true;

            if (loadedObj !== undefined && loadedObj instanceof MutableObject) {
                loadedObj.watchForChanges(false);
                loadedObj.deleteMutationOpCallback(mutCallback);
            }  
        };
    }, [objOrPromise]);

    return stateObject;

 };


export { PeerResources, usePeerResources, PeerResourcesUpdater, usePeerResourcesUpdater, useSpace, useStateObject, useStateObjectByHash };