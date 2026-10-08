import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Button } from './components/ui/button';
import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {Group,SourceUnit,Translation} from '@workbench/contracts';
import './material-library.css';

const PAGE_SIZE=80;
type Kind='all'|'document'|'ui'|'scene';
type Sort='source'|'title'|'count'|'progress';
export interface MaterialLibraryView {search:string;kind:Kind;sort:Sort;page:number;scrollTop:number}
export const defaultMaterialLibraryView:MaterialLibraryView={search:'',kind:'all',sort:'source',page:0,scrollTop:0};
export function restoreMaterialLibraryView(saved?:Partial<MaterialLibraryView>):MaterialLibraryView {return {search:typeof saved?.search==='string'?saved.search:'',kind:saved?.kind&&['all','document','ui','scene'].includes(saved.kind)?saved.kind:'all',sort:saved?.sort&&['source','title','count','progress'].includes(saved.sort)?saved.sort:'source',page:Number.isInteger(saved?.page)&&saved!.page!>=0?saved!.page!:0,scrollTop:Number.isFinite(saved?.scrollTop)&&saved!.scrollTop!>=0?saved!.scrollTop!:0};}
const kindLabel=(kind:Group['kind'])=>kind==='document'?'문서':kind==='ui'?'UI':'장면 자료';

export function MaterialLibrary({groups,unitsByGroup,translations,onOpen,view,onViewChange,restoreToken}:{view?:MaterialLibraryView;onViewChange?:(view:MaterialLibraryView)=>void;restoreToken?:number;groups:Group[];unitsByGroup:Map<string,SourceUnit[]>;translations:Record<string,Translation>;onOpen:(groupId:string)=>void}){
 const [local,setLocal]=useState<MaterialLibraryView>(()=>({...defaultMaterialLibraryView})),value=view??local,{search,kind,sort,page}=value,scrollRef=useRef<HTMLDivElement>(null);
 const change=(patch:Partial<MaterialLibraryView>)=>{const next={...value,...patch};if(onViewChange)onViewChange(next);else setLocal(next);};
 useLayoutEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTop=value.scrollTop;},[restoreToken,search,kind,sort,page]);
 const rows=useMemo(()=>{
  const query=search.trim().toLocaleLowerCase();
  const result=groups.filter(group=>(kind==='all'||group.kind===kind)&&(!query||`${group.title} ${group.id}`.toLocaleLowerCase().includes(query))).map((group,index)=>{
   const units=unitsByGroup.get(group.id)??[],translated=units.filter(unit=>!!translations[unit.id]?.text.trim()).length;
   const checked=units.filter(unit=>translations[unit.id]?.status==='checked'&&translations[unit.id]?.freshness==='current').length;
   const stale=units.filter(unit=>translations[unit.id]?.freshness==='stale').length;
   return {group,index,count:units.length,translated,checked,stale};
  });
  if(sort==='title')result.sort((a,b)=>a.group.title.localeCompare(b.group.title,'ko')||a.index-b.index);
  if(sort==='count')result.sort((a,b)=>b.count-a.count||a.index-b.index);
  if(sort==='progress')result.sort((a,b)=>(b.count?b.translated/b.count:0)-(a.count?a.translated/a.count:0)||a.index-b.index);
  return result;
 },[groups,unitsByGroup,translations,search,kind,sort]);
 const lastPage=Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1),currentPage=Math.min(page,lastPage),visible=rows.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
 return <section className="material-library" aria-label="문서와 UI 자료 목록">
  <h2 className="material-library-heading">문서·UI 자료</h2>
  <div className="material-library-controls">
   <label className="material-library-search"><span className="material-library-label">자료 검색</span><Input type="search" aria-label="자료 제목과 ID 검색" placeholder="제목·ID 검색" value={search} onChange={event=>{change({search:event.target.value,page:0,scrollTop:0});}}/></label>
   <label><span className="material-library-label">종류</span><NativeSelect aria-label="자료 종류" value={kind} onChange={event=>{change({kind:event.target.value as Kind,page:0,scrollTop:0});}}><NativeSelectOption value="all">모든 종류</NativeSelectOption><NativeSelectOption value="document">문서</NativeSelectOption><NativeSelectOption value="ui">UI</NativeSelectOption><NativeSelectOption value="scene">장면 자료</NativeSelectOption></NativeSelect></label>
   <label><span className="material-library-label">정렬</span><NativeSelect aria-label="자료 정렬" value={sort} onChange={event=>{change({sort:event.target.value as Sort,page:0,scrollTop:0});}}><NativeSelectOption value="source">원본 순서</NativeSelectOption><NativeSelectOption value="title">제목순</NativeSelectOption><NativeSelectOption value="count">원문 많은 순</NativeSelectOption><NativeSelectOption value="progress">번역 입력률 높은 순</NativeSelectOption></NativeSelect></label>
   <span className="material-library-total">{rows.length.toLocaleString()} / {groups.length.toLocaleString()}개 자료</span>
  </div>
  <div className="material-library-table-scroll" ref={scrollRef} onScroll={event=>change({scrollTop:event.currentTarget.scrollTop})}>
   <table className="material-library-table"><caption>자료 제목을 선택하면 원문과 번역을 엽니다. 번역 입력과 검토 완료는 별도로 표시합니다.</caption><thead><tr><th scope="col">제목</th><th scope="col">종류</th><th scope="col">원문 수</th><th scope="col">번역 상태</th></tr></thead><tbody>{visible.map(row=><tr key={row.group.id} onClick={()=>onOpen(row.group.id)}><th scope="row"><Button className="material-library-open" title={row.group.id} onClick={event=>{event.stopPropagation();onOpen(row.group.id);}} variant="ghost">{row.group.title}</Button></th><td>{kindLabel(row.group.kind)}</td><td className="material-library-count">{row.count.toLocaleString()}</td><td><span>번역 입력 {row.translated.toLocaleString()} / {row.count.toLocaleString()}</span><small>{row.checked?`검토 완료 ${row.checked.toLocaleString()}`:'미검토'}{row.stale?` · 재검토 ${row.stale.toLocaleString()}`:''}</small></td></tr>)}</tbody></table>
   {!rows.length?<p className="material-library-empty" role="status">{groups.length?'검색 조건에 맞는 자료가 없습니다.':'이 범위에는 문서·UI 자료가 없습니다.'}</p>:null}
  </div>
  {rows.length>PAGE_SIZE?<nav className="material-library-pages" aria-label="자료 목록 페이지"><span>{currentPage*PAGE_SIZE+1}–{Math.min((currentPage+1)*PAGE_SIZE,rows.length)} / {rows.length.toLocaleString()}개</span><Button disabled={currentPage===0} onClick={()=>change({page:currentPage-1,scrollTop:0})} variant="ghost" size="sm">이전</Button><span>{currentPage+1} / {lastPage+1}</span><Button disabled={currentPage===lastPage} onClick={()=>change({page:currentPage+1,scrollTop:0})} variant="ghost" size="sm">다음</Button></nav>:null}
 </section>;
}
