import { useState } from "react";
import { createRoot } from "react-dom/client";
import DaylightBackdrop from "../src/DaylightBackdrop.jsx";
const query = new URLSearchParams(location.search);
function Preview() {
  const [minute, setMinute] = useState(Number(query.get("minute") ?? 480));
  return <><DaylightBackdrop minute={minute} />
    {!query.has("clean") && <label style={{position:"fixed",bottom:24,left:"5%",width:"90%",background:"#fffe",borderRadius:16,padding:"12px 0",textAlign:"center"}}>
      预览天空 {`${Math.floor(minute / 60)}`.padStart(2,"0")}:{`${minute % 60}`.padStart(2,"0")}
      <input type="range" min="0" max="1439" value={minute} onChange={e=>setMinute(Number(e.target.value))} style={{display:"block",width:"90%",margin:"8px auto 0"}} />
    </label>}</>;
}
createRoot(document.getElementById("root")).render(<Preview />);
