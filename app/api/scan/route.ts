import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
export const runtime = "nodejs";
const admin=()=>createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{autoRefreshToken:false,persistSession:false}});
export async function POST(request:Request){
 try{
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Please sign in."},{status:401});
  const form=await request.formData();const text=String(form.get("text")||"").trim();const file=form.get("file");let parts:any[]=[];let fileName:string|null=null;
  if(file instanceof File&&file.size>0){if(file.size>15*1024*1024)return NextResponse.json({error:"File must be smaller than 15 MB."},{status:400});const allowed=["application/pdf","image/png","image/jpeg","image/webp","text/plain"];if(!allowed.includes(file.type))return NextResponse.json({error:"Supported formats: PDF, PNG, JPG, WEBP, TXT."},{status:400});fileName=file.name;if(file.type==="text/plain"){parts.push({text:await file.text()});}else{const bytes=Buffer.from(await file.arrayBuffer());parts.push({inline_data:{mime_type:file.type,data:bytes.toString("base64")}});}}
  if(text)parts.push({text:"User-provided document text:\n"+text});if(!parts.length)return NextResponse.json({error:"Add text or upload a document."},{status:400});
  const db=admin();const {data:profile}=await db.from("profiles").select("credits").eq("id",user.id).single();if(!profile||profile.credits<1)return NextResponse.json({error:"You have no credits remaining."},{status:402});
  const prompt=`Analyze this contract or document for a non-lawyer. Return ONLY valid JSON with keys: risk_score (integer 0-100), summary (plain language), red_flags (array of concise strings), advice (array of practical questions/actions). Score higher means greater risk. Identify uncertainty and do not invent clauses. This is informational, not legal advice.`;
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+process.env.GEMINI_API_KEY,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt},...parts]}],generationConfig:{responseMimeType:"application/json",temperature:0.2}})});
  if(!response.ok){const detail=await response.text();console.error("Gemini error",detail);return NextResponse.json({error:"AI analysis service failed. Check GEMINI_API_KEY and try again."},{status:502});}
  const payload=await response.json();const raw=payload.candidates?.[0]?.content?.parts?.[0]?.text;if(!raw)throw new Error("Empty AI response");const parsed=JSON.parse(raw);const score=Math.max(0,Math.min(100,Number(parsed.risk_score)||0));
  const {data:updated,error:creditError}=await db.from("profiles").update({credits:profile.credits-1}).eq("id",user.id).eq("credits",profile.credits).select("credits").single();if(creditError||!updated)return NextResponse.json({error:"Credit balance changed. Please try again."},{status:409});
  const {error:saveError}=await db.from("scans").insert({user_id:user.id,file_name:fileName,risk_score:score,summary:String(parsed.summary||""),red_flags:parsed.red_flags||[],advice:parsed.advice||[]});if(saveError)console.error("Scan save error",saveError);
  return NextResponse.json({...parsed,risk_score:score,credits_remaining:updated.credits});
 }catch(error){console.error(error);return NextResponse.json({error:"Could not analyze this document. Please try again."},{status:500});}
}