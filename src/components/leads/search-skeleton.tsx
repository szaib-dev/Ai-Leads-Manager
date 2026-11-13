import styles from "./global-search.module.css";
export function SearchResultSkeleton() {
 return <div role="status" aria-label="Searching businesses">{[1,2,3].map(n=><div className={styles.result} key={n}><span className="skeleton" style={{width:42,height:42,borderRadius:13}}/><span style={{flex:1}}><span className="skeleton" style={{display:"block",height:12,width:"43%",marginBottom:9}}/><span className="skeleton" style={{display:"block",height:9,width:"25%"}}/></span><span className="skeleton" style={{width:95,height:11}}/></div>)}</div>;
}
export function SearchSkeleton() {
 return <div className={styles.screen} aria-busy="true" role="status" aria-label="Loading search"><div className={styles.top}><span className="skeleton" style={{width:110,height:12}}/><span className={styles.wordmark}>folio.</span><span className="skeleton" style={{width:28,height:12}}/></div><div className={styles.content}><p className={styles.eyebrow}>YOUR ENTIRE WORKSPACE, ONE SEARCH</p><h1>Who are you looking for?</h1><div className={styles.searchline} style={{height:72}}><span className="skeleton" style={{width:"65%",height:22}}/></div><div style={{marginTop:60}}><SearchResultSkeleton/></div></div></div>;
}
