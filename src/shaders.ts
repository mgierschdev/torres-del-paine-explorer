export const skyVertex = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyFragment = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uClouds;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) {
    float v=0.0, a=0.5;
    for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.03+17.2;a*=0.5;}
    return v;
  }
  void main() {
    float h = clamp(vWorld.y * .5 + .5, 0.0, 1.0);
    vec3 horizon = vec3(.49,.62,.72);
    vec3 zenith = vec3(.11,.18,.27);
    vec3 color = mix(horizon, zenith, smoothstep(.18,.9,h));
    vec2 cloudUv = vWorld.xz / max(.08, vWorld.y + .2) * .42 + vec2(uTime*.002, 0.0);
    float cloudField = fbm(cloudUv*2.4) + fbm(cloudUv*.75+8.1)*.34;
    float clouds = smoothstep(.42,.74,cloudField) * smoothstep(-.04,.22,vWorld.y) * uClouds;
    float light = smoothstep(.3,.88,fbm(cloudUv*1.05+4.2));
    color = mix(color, vec3(.29,.35,.42) + light*.3, clouds*.9);
    color *= 1.0 - clouds * smoothstep(.38,.8,fbm(cloudUv*1.6-2.7)) * .28;
    float ceiling = smoothstep(.08,.72,vWorld.y) * uClouds;
    vec3 overcast = mix(vec3(.25,.31,.38), vec3(.6,.66,.69), light);
    color = mix(color, overcast, ceiling*(.26+clouds*.34));
    color += (fbm(cloudUv*3.1+2.4)-.5) * ceiling * .62;
    float sun = pow(max(dot(vWorld, normalize(vec3(.72,.28,-.34))),0.0), 72.0);
    color += vec3(1.0,.78,.48)*sun*.42;
    gl_FragColor = vec4(color,1.0);
  }
`;

export const waterVertex = /* glsl */`
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vWater;
  attribute float aWater;
  void main(){
    vUv=uv;
    vWater=aWater;
    vec4 world=modelMatrix*vec4(position,1.0);
    vWorldPosition=world.xyz;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

export const waterFragment = /* glsl */`
  precision highp float;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vWater;
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uFogColor;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
  }
  float wave(vec2 p){
    return noise(p*.75+vec2(uTime*.08,-uTime*.035))*.58
      +noise(p*1.9+vec2(-uTime*.055,uTime*.07))*.28
      +sin(dot(p,vec2(-1.2,1.7))+uTime*.25)*.045;
  }
  void main(){
    if(vWater < .38) discard;
    vec2 p=vWorldPosition.xz*.28;
    float e=.05;
    float h=wave(p);
    vec3 n=normalize(vec3(wave(p-vec2(e,0.))-wave(p+vec2(e,0.)),e*5.,wave(p-vec2(0.,e))-wave(p+vec2(0.,e))));
    vec3 viewDir=normalize(cameraPosition-vWorldPosition);
    float fresnel=pow(1.0-max(dot(viewDir,n),0.0),3.0);
    float spec=pow(max(dot(reflect(-uSunDirection,n),viewDir),0.0),96.0);
    vec3 deep=vec3(.015,.16,.25), sky=vec3(.3,.52,.67);
    vec3 color=mix(deep,sky,.2+fresnel*.64)+spec*vec3(1.,.86,.64)*.7+h*.008;
    float dist=length(cameraPosition-vWorldPosition);
    color=mix(color,uFogColor,1.0-exp(-dist*.0024));
    gl_FragColor=vec4(color,.94);
  }
`;
