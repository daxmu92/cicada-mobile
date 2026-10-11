export type SyncPhase = 'readingRemote' | 'readingLocal' | 'merging' | 'writingLocal' | 'uploading' | 'retrying';
export function syncErrorHint(status: string, error: string | null): string {
 if(/SQLITE_BUSY|SQLITE_LOCKED|database (?:is )?locked/i.test(error??''))return 'syncDiagnostics.locked';
 if(status==='authError')return 'syncDiagnostics.auth';
 if(status==='offline'||/timed out|network unavailable/i.test(error??''))return 'syncDiagnostics.network';
 if(/412|precondition|conflict/i.test(error??''))return 'syncDiagnostics.conflict';
 if(/schemaVersion|encrypted|UnsupportedRemote/i.test(error??''))return 'syncDiagnostics.version';
 if(/parse|invalid|JSON|corrupt/i.test(error??''))return 'syncDiagnostics.document';
 return 'syncDiagnostics.generic';
}
