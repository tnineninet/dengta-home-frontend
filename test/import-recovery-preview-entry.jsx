import {createRoot} from 'react-dom/client';
import Preview from './import-recovery-preview.jsx';
import '../src/index.css';
const root=createRoot(document.getElementById('root'));root.render(<Preview/>);
const style=document.createElement('style');
style.textContent='body{margin:0;background:#f5f3ef;color:#302d34;overflow:auto;font-family:system-ui,sans-serif}.import-preview-shell{max-width:720px;margin:auto;padding:20px 12px;min-width:0}.import-preview-shell h1{font-size:24px}.import-preview-shell>button{min-height:44px;border-radius:14px;padding:8px 16px}.content-import-error small{display:block;overflow-wrap:anywhere}.content-import button{min-height:44px}.content-import-source>button:not(.content-import-primary){border-radius:14px;padding:8px 12px}';
document.head.append(style);
if(import.meta.hot)import.meta.hot.dispose(()=>{root.unmount();style.remove();});
