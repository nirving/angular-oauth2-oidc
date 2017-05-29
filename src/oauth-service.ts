import {Base64} from "js-base64";
import {fromByteArray} from "base64-js";
import * as _sha256 from "sha256";
import {Headers, Http, URLSearchParams} from "@angular/http";
import {Injectable} from "@angular/core";
import {Observable, Observer} from "rxjs";
import {isNullOrUndefined} from "util";

var sha256: any = _sha256;

@Injectable()
export class OAuthService {

    public clientId = "";
    public redirectUri = "";
    public loginUrl = "";
    public loginUrlArgs = "";
    public scope = "";
    public resource = "";
    public rngUrl = "";
    public oidc = false;
    public options: any;
    public state = "";
    public issuer = "";
    public validationHandler: any;
    public logoutUrl = "";
    public clearHashAfterLogin: boolean = true;
    public tokenEndpoint: string;
    public userinfoEndpoint: string;

    public dummyClientSecret: string;
    
    public discoveryDocumentLoaded: boolean = false;
    public discoveryDocumentLoaded$: Observable<any>;
    private discoveryDocumentLoadedSender: Observer<any>;

    private grantTypesSupported: Array<string> = [];

    public setStorage(storage: Storage) {
        this._storage = storage;
    }
    
    private _storage: Storage = localStorage;

    private _saveItem(key: string, data: string, namespace?: string): void {
            if (!isNullOrUndefined(namespace)) {
            key = namespace + '/' + key;
        }
        this._storage.setItem(key, data);
    }

    private _loadItem(key: string, namespace?: string): string | null {
        if (!isNullOrUndefined(namespace)) {
            key = namespace + '/' + key;
        }
        return this._storage.getItem(key)
    }

    private _removeItem(key: string, namespace?: string): void {
        if (!isNullOrUndefined(namespace)) {
            key = namespace + '/' + key;
        }
        this._storage.removeItem(key);
    }



    constructor(private http: Http) {
        this.discoveryDocumentLoaded$ = Observable.create(sender => {
            this.discoveryDocumentLoadedSender = sender;
        }).publish().connect();
    }

    loadDiscoveryDocument(fullUrl: string = null): Promise<any> {

        return new Promise((resolve, reject) => {

            if (!fullUrl) {
                fullUrl = this.issuer + '/.well-known/openid-configuration';
            }

            this.http.get(fullUrl).map(r => r.json()).subscribe(
                (doc) => {

                    this.loginUrl = doc.authorization_endpoint;
                    this.logoutUrl = doc.end_session_endpoint;
                    this.grantTypesSupported = doc.grant_types_supported;
                    this.issuer = doc.issuer;
                    // this.jwks_uri = this.jwks_uri;
                    this.tokenEndpoint = doc.token_endpoint;
                    this.userinfoEndpoint = doc.userinfo_endpoint;

                    this.discoveryDocumentLoaded = true;
                    this.discoveryDocumentLoadedSender.next(doc);
                    resolve(doc);
                },
                (err) => {
                    console.error('error loading dicovery document', err);
                    reject(err);
                }
            );
        });

    }

    fetchTokenUsingPasswordFlowAndLoadUserProfile(userName: string, password: string, namespace?: string) {
        return this
                .fetchTokenUsingPasswordFlow(userName, password)
                .then(() => this.loadUserProfile(namespace));
    }

    loadUserProfile(namespace?: string) {
        if (!this.hasValidAccessToken(namespace)) throw Error("Can not load User Profile without access_token");

        return new Promise((resolve, reject) => {

            let headers = new Headers();
            headers.set('Authorization', 'Bearer ' + this.getAccessToken(namespace));

            this.http.get(this.userinfoEndpoint, { headers }).map(r => r.json()).subscribe(
                (doc) => {
                    console.debug('userinfo received', doc);
                    this._saveItem('id_token_claims_obj', doc, namespace);
                    resolve(doc);
                },
                (err) => {
                    console.error('error loading user info', err);
                    reject(err);
                }
            );
        });


    }

    fetchTokenUsingPasswordFlow(userName: string, password: string, namespace?: string) {

        return new Promise((resolve, reject) => {
            let search = new URLSearchParams();
            search.set('grant_type', 'password');
            search.set('client_id', this.clientId);
            search.set('scope', this.scope);
            search.set('username', userName);
            search.set('password', password);

            if (this.dummyClientSecret) {
                search.set('client_secret', this.dummyClientSecret);
            }

            let headers = new Headers();
            headers.set('Content-Type', 'application/x-www-form-urlencoded');

            let params = search.toString();

            this.http.post(this.tokenEndpoint, params, { headers }).map(r => r.json()).subscribe(
                (tokenResponse) => {
                    console.debug('tokenResponse', tokenResponse);
                    this.storeAccessTokenResponse(tokenResponse.access_token, tokenResponse.refresh_token, tokenResponse.expires_in, namespace);

                    resolve(tokenResponse);
                },
                (err) => {
                    console.error('Error performing password flow', err);
                    reject(err);
                }
            );
        });

    }


    refreshToken(namespace?: string) {

        return new Promise((resolve, reject) => {
            let search = new URLSearchParams();
            search.set('grant_type', 'refresh_token');
            search.set('client_id', this.clientId);
            search.set('scope', this.scope);
            search.set('refresh_token', this._loadItem('refresh_token', namespace));

            if (this.dummyClientSecret) {
                search.set('client_secret', this.dummyClientSecret);
            }

            let headers = new Headers();
            headers.set('Content-Type', 'application/x-www-form-urlencoded');

            let params = search.toString();

            this.http.post(this.tokenEndpoint, params, { headers }).map(r => r.json()).subscribe(
                (tokenResponse) => {
                    console.debug('refresh tokenResponse', tokenResponse);
                    this.storeAccessTokenResponse(tokenResponse.access_token, tokenResponse.refresh_token, tokenResponse.expires_in, namespace);
                    resolve(tokenResponse);
                },
                (err) => {
                    console.error('Error performing password flow', err);
                    reject(err);
                }
            );
        });

    }


    createLoginUrl(state, namespace?: string) {
        var that = this;

        if (typeof state === "undefined") { state = ""; }

        return this.createAndSaveNonce(namespace).then(function (nonce: any) {

            if (state) {
                state = nonce + ";" + state;
            }
            else {
                state = nonce;
            }

            var response_type = "token";

            if (that.oidc) {
                response_type = "id_token+token";
            }

            var url = that.loginUrl
                        + "?response_type="
                        + response_type
                        + "&client_id="
                        + encodeURIComponent(that.clientId)
                        + "&state="
                        + encodeURIComponent(state)
                        + "&redirect_uri="
                        + encodeURIComponent(that.redirectUri)
                        + "&scope="
                        + encodeURIComponent(that.scope);

            if (that.loginUrlArgs != null && that.loginUrlArgs != '') {
                url = url + "&" + that.loginUrlArgs;
            }

            if (that.resource) {
                url += "&resource=" + encodeURIComponent(that.resource);
            }

            if (that.oidc) {
                url += "&nonce=" + encodeURIComponent(nonce);
            }

            return url;
        });
    };

    initImplicitFlow(additionalState = ""/*, logInAnotherWindows?:boolean*/) {
        //if(logInAnotherWindows){
        //    this.createLoginUrl(additionalState).then(function (url) {
        //        location.href = url;
        //    });
        //} else {
        //    this.createLoginUrl(additionalState).then(function (url) {
        //        window.open(
        //            url,
        //            '_blank' // <- This is what makes it open in a new window.
        //        );
        //    });
        //}
        
        this.createLoginUrl(additionalState).then(function (url) {
            location.href = url;
        })
        .catch(function (error) {
            console.error("Error in initImplicitFlow");
            console.error(error);
        });
    };

    callEventIfExists(options: any, namespace?: string) {
        var that = this;
        if (options.onTokenReceived) {
            var tokenParams = {
                idClaims: that.getIdentityClaims(namespace),
                idToken: that.getIdToken(namespace),
                accessToken: that.getAccessToken(namespace),
                state: that.state
            };
            options.onTokenReceived(tokenParams);
        }
    }

    private storeAccessTokenResponse(accessToken: string, refreshToken: string, expiresIn: number, namespace?: string) {
        this._saveItem("access_token", accessToken, namespace);

        if (expiresIn) {
            var expiresInMilliSeconds = expiresIn * 1000;
            var now = new Date();
            var expiresAt = now.getTime() + expiresInMilliSeconds;
            this._saveItem("expires_at", "" + expiresAt, namespace);
        }

        if (refreshToken) {
            this._saveItem("refresh_token", refreshToken, namespace);
        }
    }

    tryLogin(options, namespace?: string) {

        options = options || { };


        var parts = this.getFragment();

        var accessToken = parts["access_token"];
        var idToken = parts["id_token"];
        var state = parts["state"];

        var oidcSuccess = false;
        var oauthSuccess = false;

        if (!accessToken || !state) return false;
        if (this.oidc && !idToken) return false;

        var savedNonce = this._loadItem("nonce", namespace);

        var stateParts = state.split(';');
        var nonceInState = stateParts[0];
        if (savedNonce === nonceInState) {

            this.storeAccessTokenResponse(accessToken, null, parts['expires_in'], namespace);

            if (stateParts.length > 1) {
                this.state = stateParts[1];
            }

            oauthSuccess = true;

        }

        if (!oauthSuccess) return false;

        if (this.oidc) {
            oidcSuccess = this.processIdToken(idToken, accessToken, namespace);
            if (!oidcSuccess) return false;
        }

        if (options.validationHandler) {

            var validationParams = {accessToken: accessToken, idToken: idToken};

            options
                .validationHandler(validationParams)
                .then(() => {
                    this.callEventIfExists(options);
                })
                .catch(function(reason) {
                    console.error('Error validating tokens');
                    console.error(reason);
                })
        }
        else {
            this.callEventIfExists(options);
        }

        // NEXT VERSION: Notify parent-window (iframe-refresh)
        /*
        var win = window;
        if (win.parent && win.parent.onOAuthCallback) {
            win.parent.onOAuthCallback(this.state);
        }
        */

        if (this.clearHashAfterLogin) location.hash = '';

        return true;
    };

    processIdToken(idToken, accessToken, namespace?: string) {
            var tokenParts = idToken.split(".");
            var claimsBase64 = this.padBase64(tokenParts[1]);
            var claimsJson = Base64.decode(claimsBase64);
            var claims = JSON.parse(claimsJson);
            var savedNonce = this._loadItem("nonce", namespace);

            if (Array.isArray(claims.aud)) {
                if (claims.aud.every(v => v !== this.clientId)) {
                    console.warn("Wrong audience: " + claims.aud.join(","));
                    return false;
                }
            } else {
                if (claims.aud !== this.clientId) {
                    console.warn("Wrong audience: " + claims.aud);
                    return false;
                }
            }

            if (this.issuer && claims.iss !== this.issuer) {
                console.warn("Wrong issuer: " + claims.iss);
                return false;
            }

            if (claims.nonce !== savedNonce) {
                console.warn("Wrong nonce: " + claims.nonce);
                return false;
            }

            if (accessToken && !this.checkAtHash(accessToken, claims)) {
                console.warn("Wrong at_hash");
                return false;
            }

            // Das Prüfen des Zertifikates wird der Serverseite überlassen!

            var now = Date.now();
            var issuedAtMSec = claims.iat * 1000;
            var expiresAtMSec = claims.exp * 1000;

            var tenMinutesInMsec = 1000 * 60 * 10;

            if (issuedAtMSec - tenMinutesInMsec >= now  || expiresAtMSec + tenMinutesInMsec <= now) {
                console.warn("Token has been expired");
                console.warn({
                    now: now,
                    issuedAtMSec: issuedAtMSec,
                    expiresAtMSec: expiresAtMSec
                });
                return false;
            }

            this._saveItem("id_token", idToken, namespace);
            this._saveItem("id_token_claims_obj", claimsJson, namespace);
            this._saveItem("id_token_expires_at", "" + expiresAtMSec, namespace);

            if (this.validationHandler) {
                this.validationHandler(idToken)
            }

            return true;
    }

    getIdentityClaims(namespace?: string) {
        var claims = this._loadItem("id_token_claims_obj", namespace);
        if (!claims) return null;
        return JSON.parse(claims);
    }

    getIdToken(namespace?: string) {
        return this._loadItem("id_token", namespace);
    }

    padBase64(base64data) {
        while (base64data.length % 4 !== 0) {
            base64data += "=";
        }
        return base64data;
    }

    tryLoginWithIFrame() {
        throw new Error("tryLoginWithIFrame has not been implemented so far");
    };

    tryRefresh(timeoutInMsec) {
        throw new Error("tryRefresh has not been implemented so far");
    };

    getAccessToken(namespace?: string) {
        return this._loadItem("access_token", namespace);
    };

    hasValidAccessToken(namespace?: string) {
        if (this.getAccessToken(namespace)) {

            var expiresAt = this._loadItem("expires_at",namespace);
            var now = new Date();
            if (expiresAt && parseInt(expiresAt) < now.getTime()) {
                return false;
            }

            return true;
        }

        return false;
    };

    hasValidIdToken(namespace?: string) {
        if (this.getIdToken(namespace)) {

            var expiresAt = this._loadItem("id_token_expires_at", namespace);
            var now = new Date();
            if (expiresAt && parseInt(expiresAt) < now.getTime()) {
                return false;
            }

            return true;
        }

        return false;
    };

    authorizationHeader(namespace?: string) {
        return "Bearer " + this.getAccessToken(namespace);
    }

    logOut(noRedirectToLogoutUrl: boolean = false, namespace?: string) {
        var id_token = this.getIdToken(namespace);
        this._removeItem("access_token", namespace);
        this._removeItem("id_token", namespace);
        this._removeItem("refresh_token", namespace);
        this._removeItem("nonce", namespace);
        this._removeItem("expires_at", namespace);
        this._removeItem("id_token_claims_obj", namespace);
        this._removeItem("id_token_expires_at", namespace);

        if (!this.logoutUrl) return;
        if (noRedirectToLogoutUrl) return;

        let logoutUrl: string;

        // For backward compatibility
        if (this.logoutUrl.indexOf('{{') > -1) {
            logoutUrl = this.logoutUrl.replace(/\{\{id_token\}\}/, id_token);
        }
        else {
            logoutUrl = this.logoutUrl + "?id_token_hint="
                                + encodeURIComponent(id_token)
                                + "&post_logout_redirect_uri="
                                + encodeURIComponent(this.redirectUri);
        }
        location.href = logoutUrl;
    };

    createAndSaveNonce(namespace?: string) {
        var that = this;
        return this.createNonce().then(function (nonce: any) {
            that._saveItem("nonce", nonce, namespace);
            return nonce;
        })

    };

    createNonce() {
        
        return new Promise((resolve, reject) => { 
        
            if (this.rngUrl) {
                throw new Error("createNonce with rng-web-api has not been implemented so far");
            }
            else {
                var text = "";
                var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

                for (var i = 0; i < 40; i++)
                    text += possible.charAt(Math.floor(Math.random() * possible.length));
                
                resolve(text);
            }
        
        });
    };

    getFragment() {
        if (window.location.hash.indexOf("#") === 0) {
            return this.parseQueryString(window.location.hash.substr(1));
        } else {
            return {};
        }
    };

    parseQueryString(queryString) {
        var data = {}, pairs, pair, separatorIndex, escapedKey, escapedValue, key, value;

        if (queryString === null) {
            return data;
        }

        pairs = queryString.split("&");

        for (var i = 0; i < pairs.length; i++) {
            pair = pairs[i];
            separatorIndex = pair.indexOf("=");

            if (separatorIndex === -1) {
                escapedKey = pair;
                escapedValue = null;
            } else {
                escapedKey = pair.substr(0, separatorIndex);
                escapedValue = pair.substr(separatorIndex + 1);
            }

            key = decodeURIComponent(escapedKey);
            value = decodeURIComponent(escapedValue);

            if (key.substr(0, 1) === '/')
                key = key.substr(1);

            data[key] = value;
        }

        return data;
    };

    

    checkAtHash(accessToken, idClaims) {
        if (!accessToken || !idClaims || !idClaims.at_hash ) return true;
        var tokenHash: Array<any> = sha256(accessToken, { asBytes: true });
        var leftMostHalf = tokenHash.slice(0, (tokenHash.length/2) );
        var tokenHashBase64 = fromByteArray(leftMostHalf);
        var atHash = tokenHashBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        var claimsAtHash = idClaims.at_hash.replace(/=/g, "");
        
        var atHash = tokenHashBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

        if (atHash != claimsAtHash) {
            console.warn("exptected at_hash: " + atHash);    
            console.warn("actual at_hash: " + claimsAtHash);
        }
        
        
        return (atHash == claimsAtHash);
    }
    
}
