---
layout: layouts/article.njk
title: "js树形索引，多关键字并查"
date: 2013-05-01T03:00:38Z
updated: 2013-10-17T07:06:44Z
tags:
  - javascript
  - efficiency
---

在博客园上看到[EtherDream](http://www.cnblogs.com/index-html/)的[JavaScript 上万关键字瞬间匹配](http://www.cnblogs.com/index-html/archive/2013/04/17/3025682.html)这篇文章，感觉不错。于是改了DEMO里面的代码（耦合度是在是太高了，几乎得重新一遍才行……）

这种方法的有点就是：树形的结构擅长于同时匹配**多个**关键字。单个关键字来说，直接用indexOf来查询、切割字符串，速度更快。

改动主要在两个方面：
- 对语句规范化（[JSHint](http://www.jshint.com/)规范）;
- 改写了一部分语句，核心的语句效率几乎是达到最大，比如 `if(match === true)` 比 `if(match)` 快，另外把得出的匹配结果可读化，这个有点耗资源，不过有它存在的必要性，在后期处理数据时更快。

**核心代码：**

``` javascript
var treeSearch = {
    makeTree: function(strKeys) {
        "use strict";
        var tblCur = {},
            tblRoot,
            key,
            str_key,
            Length,
            j,
            i
            ;
        tblRoot = tblCur;
        for ( j = strKeys.length - 1; j >= 0; j -= 1) {
            str_key = strKeys[j];
            Length = str_key.length;
            for ( i = 0; i < Length; i += 1) {
                key = str_key.charAt(i);
                if (tblCur.hasOwnProperty(key)) { //生成子节点 
                    tblCur = tblCur[key];
                } else {
                    tblCur = tblCur[key] = {};
                }
            }
            tblCur.end = true; //最后一个关键字没有分割符
            tblCur = tblRoot;
        }
        return tblRoot;
    },
    search: function(content, tblRoot) {
        "use strict";
        var tblCur,
            p_star = 0,
            n = content.length,
            p_end,
            match,  //是否找到匹配
            match_key,
            match_str,
            arrMatch = [],  //存储结果
            arrLength = 0   //arrMatch的长度索引
            ;
        while (p_star < n) {
            tblCur = tblRoot; //回溯至根部
            p_end = p_star;
            match_str = "";
            match = false;
            do {
                match_key = content.charAt(p_end);
                if (!(tblCur = tblCur[match_key])) { //本次匹配结束
                    p_star += 1;
                    break;
                }else{
                    match_str += match_key;
                }
                p_end += 1;
                if (tblCur.end === true) //是否匹配到尾部  //找到匹配关键字
                {
                    match = true;
                }
            } while (true);
            if (match === true) { //最大匹配
                arrMatch[arrLength] = { //增强可读性
                    key: match_str,
                    begin: p_star - 1,
                    end: p_end
                };
                arrLength += 1;
                p_star = p_end;
            }
        }
        return arrMatch;
    }
};
```

**使用实例：**

``` javascript
function test(strContent, strKeys) {
    var arrMatch,
        tblRoot = treeSearch.makeTree(strKeys);
    console.time("treeSearch");
    arrMatch = treeSearch.search(strContent, tblRoot);
    console.timeEnd("treeSearch");
    console.log(arrMatch);
}
var s = (function() {
    var Things = [' ', '\n', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
    var s = "";
    for (var i = 1000000; i >= 0; i--) {
        s += Things[parseInt(Math.random() * Things.length) % Things.length]
    };
    return s;
})()
test(s, ["abc", "efge", "fun", "tree"]);
```

**2013/4/18 23:04:35**
