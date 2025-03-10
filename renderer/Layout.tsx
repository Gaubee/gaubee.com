export { Layout };

import React from "react";
import { PageContextProvider } from "./usePageContext.tsx";
import { Link } from "./Link.tsx";
import type { PageContext } from "vike/types";
import "./css/index.css";
import "./Layout.css";

function Layout({
  children,
  pageContext,
}: {
  children: React.ReactNode;
  pageContext: PageContext;
}) {
  return (
    <React.StrictMode>
      <PageContextProvider pageContext={pageContext}>
        <Frame>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              maxHeight: "100vh",
              width: "38%",
              maxWidth: "26em",
              position: "sticky",
              top: 0,
            }}
          >
            <Sidebar>
              <Logo />
              <Link href="/">Timeline</Link>
              <Link href="/projects">Projects</Link>
              <Link href="/about">About</Link>
              {/* <Link href="/star-wars">Data Fetching</Link> */}
            </Sidebar>
            <div style={{ padding: "16px" }}>
              <small>
                本网站不收集任何访问者的行为与信息，不做任何商业运作，仅仅为个人使用。
              </small>
              <small style={{ display: "block", marginTop: "8px" }}>
                <a href="https://beian.miit.gov.cn/#/Integrated/recordQuery">
                  闽ICP备17026139号-1
                </a>
              </small>
            </div>
          </div>
          <Content>{children}</Content>
        </Frame>
      </PageContextProvider>
    </React.StrictMode>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        maxWidth: 900,
        margin: "auto",
      }}
    >
      {children}
    </div>
  );
}

function Sidebar({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      id="sidebar"
      style={{
        padding: 20,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        lineHeight: "1.8em",
        borderRight: "2px solid #eee",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Content({ children }: { children: React.ReactNode }) {
  return (
    <div id="page-container">
      <div
        id="page-content"
        style={{
          padding: 20,
          paddingBottom: 50,
          minHeight: "100vh",
          backgroundColor: "#fafafa" /* 浅灰背景降低视觉疲劳 */,
          color: "#333" /* 深灰文字提高对比度 */,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div
      style={{
        marginTop: 20,
        marginBottom: 10,
      }}
    >
      <a href="/">
        <img src="/img/head.webp" height={64} width={64} alt="logo" />
      </a>
    </div>
  );
}
