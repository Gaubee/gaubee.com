import{j as e}from"./jsx-runtime.EKYJJIwR.js";import{B as p,v as u}from"./github.CTNm7F17.js";import{C as h,a as f,b as k,d as x,c as y}from"./card.BVsoAawH.js";import{I as g}from"./input.DZQlNEot.js";import{r as s}from"./index.AZrhv8Ai.js";import{c as m}from"./createLucideIcon.CQY4rzge.js";import"./index.CL9-kuLt.js";import"./utils.DYjWO4Tu.js";/**
 * @license lucide-react v0.544.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["path",{d:"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",key:"1s6t7t"}],["circle",{cx:"16.5",cy:"7.5",r:".5",fill:"currentColor",key:"w0ekpg"}]],v=m("key-round",j);/**
 * @license lucide-react v0.544.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],T=m("loader-circle",C),o="github_token";function K(){const[t,r]=s.useState(""),[n,c]=s.useState(!1),[l,i]=s.useState(null);s.useEffect(()=>{const a=localStorage.getItem(o);a&&r(a)},[]);const d=async()=>{c(!0),i(null);const a=await u(t);c(!1),a?(localStorage.setItem(o,t),window.location.href="/admin"):(i("Invalid token. Please check your token and try again."),localStorage.removeItem(o))};return e.jsxs(h,{children:[e.jsxs(f,{children:[e.jsxs(k,{className:"flex items-center",children:[e.jsx(v,{className:"mr-2"})," Enter Your Access Token"]}),e.jsx(x,{children:"To use the admin panel, please provide a GitHub Personal Access Token with repository access."})]}),e.jsxs(y,{className:"space-y-4",children:[e.jsx(g,{type:"password",value:t,onChange:a=>r(a.target.value),placeholder:"ghp_...",onKeyDown:a=>a.key==="Enter"&&d()}),l&&e.jsx("p",{className:"text-sm text-destructive",children:l}),e.jsx(p,{onClick:d,disabled:n,className:"w-full",children:n?e.jsx(T,{className:"mr-2 h-4 w-4 animate-spin"}):"Save and Continue"})]})]})}export{K as default};
