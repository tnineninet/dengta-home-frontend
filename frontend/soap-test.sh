#!/system/bin/sh
L=$(cat /data/local/tmp/soap-test.xml | wc -c)
{
  echo "POST /avt HTTP/1.1"
  echo "Host: 127.0.0.1:48620"
  echo "Content-Type: text/xml; charset=utf-8"
  echo "SOAPAction: \"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI\""
  echo "Content-Length: $L"
  echo "Connection: close"
  echo ""
  cat /data/local/tmp/soap-test.xml
} | toybox nc -w 5 127.0.0.1 48620