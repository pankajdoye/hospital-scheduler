import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.regex.*;

/** Team C authoritative Appointment Data & Transaction Manager API. */
public class TeamCApiServer {
    private static final String URL = "jdbc:mysql://localhost:3306/hospital_management?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC";
    private static final String USER = "root";
    private static final String PASSWORD = System.getenv().getOrDefault("HOSPITAL_DB_PASSWORD", "YOUR_MYSQL_PASSWORD");
    private static final int PORT = 8080;
    private static final Map<String,String> TOKENS = Map.of("teamc-admin-demo","ADMIN", "teamc-provider-demo","PROVIDER", "teamc-patient-demo","PATIENT");

    public static void main(String[] args) throws Exception {
        Class.forName("com.mysql.cj.jdbc.Driver");
        try (Connection ignored = db()) { System.out.println("Connected to MySQL: hospital_management"); }
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
        server.createContext("/api/v1/health", TeamCApiServer::health);
        server.createContext("/api/v1/providers", TeamCApiServer::providers);
        server.createContext("/api/v1/patients", TeamCApiServer::patients);
        server.createContext("/api/v1/appointments", TeamCApiServer::appointments);
        server.createContext("/api/v1/audit", TeamCApiServer::audit);
        server.createContext("/api/v1/reports/utilization", TeamCApiServer::utilization);
        server.createContext("/internal/v1/recovery/verify", TeamCApiServer::recovery);
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(12));
        server.start();
        System.out.println("Team C API running at http://localhost:" + PORT + "/api/v1");
        System.out.println("Demo token: Bearer teamc-admin-demo");
    }

    private static Connection db() throws SQLException { return DriverManager.getConnection(URL, USER, PASSWORD); }

    private static void health(HttpExchange e) throws IOException {
        send(e, 200, envelope("{\"status\":\"UP\",\"database\":\"hospital_management\"}", correlation(e)));
    }

    private static void providers(HttpExchange e) throws IOException {
        try {
            if (auth(e) == null) return;
            String path = e.getRequestURI().getPath();
            Matcher calendar = Pattern.compile("/api/v1/providers/(\\d+)/calendar").matcher(path);
            if ("GET".equals(e.getRequestMethod()) && calendar.matches()) {
                int doctorId = Integer.parseInt(calendar.group(1));
                StringBuilder out = new StringBuilder("["); boolean first = true;
                String sql = "SELECT interval_id,interval_date,start_time,end_time,interval_type,reason,calendar_version FROM provider_calendar_intervals WHERE doctor_id=? ORDER BY interval_date,start_time";
                try (Connection c=db(); PreparedStatement p=c.prepareStatement(sql)) {
                    p.setInt(1, doctorId);
                    try (ResultSet r=p.executeQuery()) {
                        while (r.next()) { if (!first) out.append(','); first=false; out.append("{\"interval_id\":").append(r.getLong(1)).append(",\"date\":").append(json(String.valueOf(r.getDate(2)))).append(",\"start\":").append(json(String.valueOf(r.getTime(3)))).append(",\"end\":").append(json(String.valueOf(r.getTime(4)))).append(",\"type\":").append(json(r.getString(5))).append(",\"reason\":").append(json(r.getString(6))).append(",\"calendar_version\":").append(r.getLong(7)).append('}'); }
                    }
                }
                send(e, 200, envelope(out.append(']').toString(), correlation(e))); return;
            }
            if ("GET".equals(e.getRequestMethod()) && "/api/v1/providers".equals(path)) {
                StringBuilder out = new StringBuilder("["); boolean first = true;
                try (Connection c=db(); PreparedStatement p=c.prepareStatement("SELECT doctor_id,full_name,specialization,phone,email,room_no,available FROM doctors ORDER BY doctor_id"); ResultSet r=p.executeQuery()) {
                    while (r.next()) { if (!first) out.append(','); first=false; out.append("{\"provider_id\":").append(r.getInt(1)).append(",\"full_name\":").append(json(r.getString(2))).append(",\"specialization\":").append(json(r.getString(3))).append(",\"phone\":").append(json(r.getString(4))).append(",\"email\":").append(json(r.getString(5))).append(",\"room_no\":").append(json(r.getString(6))).append(",\"available\":").append(r.getBoolean(7)).append('}'); }
                }
                send(e, 200, envelope(out.append(']').toString(), correlation(e))); return;
            }
            fail(e, 404, "NOT_FOUND", "Provider route not found");
        } catch (Exception x) { serverError(e, x); }
    }

    private static void patients(HttpExchange e) throws IOException {
        try {
            Auth a=auth(e); if(a==null)return;
            if ("GET".equals(e.getRequestMethod())) {
                StringBuilder out=new StringBuilder("["); boolean first=true;
                try(Connection c=db(); PreparedStatement p=c.prepareStatement("SELECT patient_id,full_name,gender,date_of_birth,phone,email,address FROM patients ORDER BY patient_id"); ResultSet r=p.executeQuery()) {
                    while(r.next()){if(!first)out.append(',');first=false;out.append("{\"user_id\":").append(r.getInt(1)).append(",\"full_name\":").append(json(r.getString(2))).append(",\"gender\":").append(json(r.getString(3))).append(",\"date_of_birth\":").append(json(String.valueOf(r.getDate(4)))).append(",\"phone\":").append(json(r.getString(5))).append(",\"email\":").append(json(r.getString(6))).append(",\"address\":").append(json(r.getString(7))).append('}');}
                }
                send(e,200,envelope(out.append(']').toString(),correlation(e))); return;
            }
            if ("POST".equals(e.getRequestMethod())) {
                Map<String,String>b=parse(readBody(e)); String name=required(b,"fullName"),gender=required(b,"gender"),dob=required(b,"dateOfBirth"),phone=required(b,"phone"),email=required(b,"email");
                if(!phone.matches("\\d{10}"))throw new Bad("VALIDATION_ERROR","Phone must contain exactly 10 digits.");
                if(!email.matches("^[A-Za-z0-9._%+-]+@gmail\\.com$"))throw new Bad("VALIDATION_ERROR","Email must be a valid @gmail.com address.");
                try(Connection c=db();PreparedStatement p=c.prepareStatement("INSERT INTO patients(full_name,gender,date_of_birth,phone,email,address) VALUES(?,?,?,?,?,?)",Statement.RETURN_GENERATED_KEYS)){
                    p.setString(1,name);p.setString(2,gender);p.setDate(3,java.sql.Date.valueOf(LocalDate.parse(dob)));p.setString(4,phone);p.setString(5,email);p.setString(6,b.getOrDefault("address",""));p.executeUpdate();int id=generatedId(p);audit(c,a.role,"CREATE","patients",id,null,"{\"full_name\":"+json(name)+"}",correlation(e));send(e,201,envelope("{\"user_id\":"+id+",\"message\":\"Patient registered\"}",correlation(e)));return;
                }
            }
            fail(e,405,"METHOD_NOT_ALLOWED","Use GET or POST");
        } catch(Bad x){fail(e,400,x.code,x.getMessage());} catch(Exception x){serverError(e,x);}
    }

    private static void appointments(HttpExchange e) throws IOException {
        try {
            Auth a=auth(e); if(a==null)return; String path=e.getRequestURI().getPath();
            Matcher one=Pattern.compile("/api/v1/appointments/(\\d+)(/cancel)?").matcher(path);
            if("GET".equals(e.getRequestMethod()) && "/api/v1/appointments".equals(path)){listAppointments(e);return;}
            if("POST".equals(e.getRequestMethod()) && "/api/v1/appointments".equals(path)){book(e,a);return;}
            if(one.matches() && "GET".equals(e.getRequestMethod())){appointmentDetail(e,Integer.parseInt(one.group(1)));return;}
            if(one.matches() && "POST".equals(e.getRequestMethod()) && one.group(2)!=null){cancel(e,a,Integer.parseInt(one.group(1)));return;}
            fail(e,404,"NOT_FOUND","Appointment route not found");
        } catch(Bad x){fail(e,400,x.code,x.getMessage());} catch(Exception x){serverError(e,x);}
    }

    private static void listAppointments(HttpExchange e)throws Exception{
        StringBuilder out=new StringBuilder("[");boolean first=true;String q="SELECT a.appointment_id,p.full_name,d.full_name,a.appointment_date,a.appointment_time,a.status,a.reason FROM appointments a JOIN patients p ON p.patient_id=a.patient_id JOIN doctors d ON d.doctor_id=a.doctor_id ORDER BY a.appointment_date,a.appointment_time";
        try(Connection c=db();PreparedStatement p=c.prepareStatement(q);ResultSet r=p.executeQuery()){while(r.next()){if(!first)out.append(',');first=false;out.append("{\"appointment_id\":").append(r.getInt(1)).append(",\"patient\":").append(json(r.getString(2))).append(",\"provider\":").append(json(r.getString(3))).append(",\"start\":").append(json(r.getDate(4)+"T"+r.getTime(5))).append(",\"state\":").append(json(r.getString(6))).append(",\"purpose\":").append(json(r.getString(7))).append('}');}}
        send(e,200,envelope(out.append(']').toString(),correlation(e)));
    }

    private static void appointmentDetail(HttpExchange e,int id)throws Exception{
        try(Connection c=db();PreparedStatement p=c.prepareStatement("SELECT appointment_id,patient_id,doctor_id,appointment_date,appointment_time,status,reason FROM appointments WHERE appointment_id=?")){p.setInt(1,id);try(ResultSet r=p.executeQuery()){if(!r.next()){fail(e,404,"NOT_FOUND","Appointment not found");return;}String v="{\"appointment_id\":"+r.getInt(1)+",\"user_id\":"+r.getInt(2)+",\"provider_id\":"+r.getInt(3)+",\"start\":"+json(r.getDate(4)+"T"+r.getTime(5))+",\"state\":"+json(r.getString(6))+",\"purpose\":"+json(r.getString(7))+"}";send(e,200,envelope(v,correlation(e)));}}
    }

    private static void book(HttpExchange e,Auth a)throws Exception{
        String key=e.getRequestHeaders().getFirst("Idempotency-Key");if(key==null||key.isBlank())throw new Bad("IDEMPOTENCY_KEY_REQUIRED","Booking requires Idempotency-Key");
        String request=readBody(e);Map<String,String>b=parse(request);int user=Integer.parseInt(required(b,"userId")),provider=Integer.parseInt(required(b,"providerId"));LocalDate date=LocalDate.parse(required(b,"date"));LocalTime time=LocalTime.parse(required(b,"startTime"));
        try(Connection c=db()){c.setAutoCommit(false);try(PreparedStatement old=c.prepareStatement("SELECT response_status,response_body FROM teamc_idempotency_keys WHERE idempotency_key=? AND endpoint=? FOR UPDATE")){old.setString(1,key);old.setString(2,"POST /api/v1/appointments");try(ResultSet r=old.executeQuery()){if(r.next()){send(e,r.getInt(1),envelope(r.getString(2),correlation(e)));c.rollback();return;}}}
            try(PreparedStatement check=c.prepareStatement("SELECT available FROM doctors WHERE doctor_id=? FOR UPDATE")){check.setInt(1,provider);try(ResultSet r=check.executeQuery()){if(!r.next()||!r.getBoolean(1))throw new Bad("PROVIDER_UNAVAILABLE","Provider is unavailable");}}
            int id;try(PreparedStatement p=c.prepareStatement("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,reason) VALUES(?,?,?,?,?)",Statement.RETURN_GENERATED_KEYS)){p.setInt(1,user);p.setInt(2,provider);p.setDate(3,java.sql.Date.valueOf(date));p.setTime(4,Time.valueOf(time));p.setString(5,b.getOrDefault("purpose",""));p.executeUpdate();id=generatedId(p);}
            String result="{\"appointment_id\":"+id+",\"state\":\"CONFIRMED\",\"message\":\"Appointment booked\"}";audit(c,a.role,"CREATE","appointments",id,null,result,correlation(e));
            try(PreparedStatement p=c.prepareStatement("INSERT INTO teamc_idempotency_keys(idempotency_key,endpoint,request_hash,response_status,response_body,appointment_id) VALUES(?,?,?,?,?,?)")){p.setString(1,key);p.setString(2,"POST /api/v1/appointments");p.setString(3,sha(request));p.setInt(4,201);p.setString(5,result);p.setInt(6,id);p.executeUpdate();}
            c.commit();send(e,201,envelope(result,correlation(e)));
        }catch(Exception x){if(x instanceof SQLException&&((SQLException)x).getErrorCode()==1062)throw new Bad("SLOT_CONFLICT","Provider already has an appointment at that date and time");throw x;}
    }

    private static void cancel(HttpExchange e,Auth a,int id)throws Exception{
        try(Connection c=db()){c.setAutoCommit(false);try(PreparedStatement p=c.prepareStatement("UPDATE appointments SET status='CANCELLED' WHERE appointment_id=? AND status IN ('BOOKED','CONFIRMED')")){p.setInt(1,id);if(p.executeUpdate()!=1)throw new Bad("INVALID_STATE","Appointment not found or already closed");String result="{\"appointment_id\":"+id+",\"state\":\"CANCELLED\"}";audit(c,a.role,"CANCEL","appointments",id,null,result,correlation(e));c.commit();send(e,200,envelope(result,correlation(e)));}catch(Exception x){c.rollback();throw x;}finally{c.setAutoCommit(true);}}
    }

    private static void audit(HttpExchange e)throws IOException{try{Auth a=auth(e);if(a==null)return;if(!"ADMIN".equals(a.role)){fail(e,403,"FORBIDDEN","Administrator role required");return;}StringBuilder out=new StringBuilder("[");boolean first=true;String q="SELECT audit_id,actor,action_name,table_name,record_id,correlation_id,source_service,created_at FROM teamc_audit_log ORDER BY audit_id DESC LIMIT 200";try(Connection c=db();PreparedStatement p=c.prepareStatement(q);ResultSet r=p.executeQuery()){while(r.next()){if(!first)out.append(',');first=false;out.append("{\"audit_id\":").append(r.getLong(1)).append(",\"actor\":").append(json(r.getString(2))).append(",\"action\":").append(json(r.getString(3))).append(",\"table\":").append(json(r.getString(4))).append(",\"record_id\":").append(json(r.getString(5))).append(",\"correlation_id\":").append(json(r.getString(6))).append(",\"source\":").append(json(r.getString(7))).append(",\"created_at\":").append(json(String.valueOf(r.getTimestamp(8)))).append('}');}}send(e,200,envelope(out.append(']').toString(),correlation(e)));}catch(Exception x){serverError(e,x);}}
    private static void utilization(HttpExchange e)throws IOException{try{Auth a=auth(e);if(a==null)return;if(!a.role.equals("ADMIN")&&!a.role.equals("PROVIDER")){fail(e,403,"FORBIDDEN","Provider or administrator role required");return;}try(Connection c=db();Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*),SUM(status='BOOKED'),SUM(status='CANCELLED') FROM appointments")){r.next();long total=r.getLong(1),booked=r.getLong(2),cancelled=r.getLong(3);send(e,200,envelope("{\"total_appointments\":"+total+",\"booked\":"+booked+",\"cancelled\":"+cancelled+",\"cancellation_rate\":"+(total==0?0:(double)cancelled/total)+"}",correlation(e)));}}catch(Exception x){serverError(e,x);}}
    private static void recovery(HttpExchange e)throws IOException{try{Auth a=auth(e);if(a==null)return;if(!a.role.equals("ADMIN")){fail(e,403,"FORBIDDEN","Administrator role required");return;}try(Connection c=db();Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM appointments")){r.next();send(e,200,envelope("{\"status\":\"READY\",\"appointment_rows\":"+r.getLong(1)+"}",correlation(e)));}}catch(Exception x){serverError(e,x);}}

    private static Auth auth(HttpExchange e)throws IOException{String h=e.getRequestHeaders().getFirst("Authorization");if(h==null||!h.startsWith("Bearer ")){fail(e,401,"AUTHENTICATION_REQUIRED","Use Authorization: Bearer teamc-admin-demo");return null;}String role=TOKENS.get(h.substring(7));if(role==null){fail(e,401,"INVALID_TOKEN","Demo token not recognized");return null;}return new Auth(role);}
    private static void audit(Connection c,String actor,String action,String table,int id,String before,String after,String correlation)throws SQLException{try(PreparedStatement p=c.prepareStatement("INSERT INTO teamc_audit_log(actor,action_name,table_name,record_id,before_json,after_json,correlation_id,source_service) VALUES(?,?,?,?,?,?,?,?)")){p.setString(1,actor);p.setString(2,action);p.setString(3,table);p.setString(4,String.valueOf(id));p.setString(5,before);p.setString(6,after);p.setString(7,correlation);p.setString(8,"TeamC-API");p.executeUpdate();}}
    private static Map<String,String> parse(String s){Map<String,String>m=new HashMap<>();Matcher z=Pattern.compile("\\\"([^\\\"]+)\\\"\\s*:\\s*(?:\\\"((?:\\\\.|[^\\\"])*)\\\"|([^,}]+))").matcher(s);while(z.find())m.put(z.group(1),z.group(2)!=null?z.group(2):z.group(3).trim());return m;}
    private static String readBody(HttpExchange e)throws IOException{try(InputStream i=e.getRequestBody()){return new String(i.readAllBytes(),StandardCharsets.UTF_8);}}
    private static String required(Map<String,String>m,String k){if(!m.containsKey(k)||m.get(k).isBlank())throw new Bad("VALIDATION_ERROR",k+" is required");return m.get(k);}
    private static int generatedId(PreparedStatement p)throws SQLException{try(ResultSet r=p.getGeneratedKeys()){if(!r.next())throw new SQLException("ID not generated");return r.getInt(1);}}
    private static String sha(String s)throws Exception{byte[]b=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder x=new StringBuilder();for(byte v:b)x.append(String.format("%02x",v));return x.toString();}
    private static String correlation(HttpExchange e){String x=e.getRequestHeaders().getFirst("X-Correlation-ID");return x==null||x.isBlank()?UUID.randomUUID().toString():x;}
    private static String json(String s){if(s==null)return"null";return"\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
    private static String envelope(String d,String c){return"{\"data\":"+d+",\"meta\":{\"correlation_id\":"+json(c)+",\"api_version\":\"v1\"}}";}
    private static void send(HttpExchange e,int code,String s)throws IOException{byte[]b=s.getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json; charset=UTF-8");e.getResponseHeaders().set("X-Correlation-ID",correlation(e));e.sendResponseHeaders(code,b.length);try(OutputStream o=e.getResponseBody()){o.write(b);}}
    private static void fail(HttpExchange e,int code,String type,String msg)throws IOException{send(e,code,"{\"error\":{\"code\":"+json(type)+",\"message\":"+json(msg)+"},\"meta\":{\"correlation_id\":"+json(correlation(e))+",\"api_version\":\"v1\"}}");}
    private static void serverError(HttpExchange e,Exception x)throws IOException{fail(e,500,"INTERNAL_ERROR",x.getMessage()==null?"Internal server error":x.getMessage());}
    private static class Auth{final String role;Auth(String r){role=r;}}
    private static class Bad extends RuntimeException{final String code;Bad(String c,String m){super(m);code=c;}}
}
